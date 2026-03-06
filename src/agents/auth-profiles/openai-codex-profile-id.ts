import type { OpenClawConfig } from "../../config/config.js";
import type { AuthProfileConfig } from "../../config/types.js";
import { normalizeProviderId } from "../model-selection.js";
import { dedupeProfileIds, listProfilesForProvider } from "./profiles.js";
import type { AuthProfileStore, OAuthCredential, ProfileUsageStats } from "./types.js";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_AUTH_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_CODEX_DEPRECATED_PROFILE_ID = "openai-codex:codex-cli";

type JwtPayload = Record<string, unknown>;

type OpenAICodexIdentity = {
  accountId: string;
  iss: string;
  sub: string;
};

function decodeBase64UrlSegment(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeJwtPayload(token: string): JwtPayload | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payloadSegment = parts[1] ?? "";
  if (!payloadSegment) {
    return null;
  }
  try {
    const decoded = decodeBase64UrlSegment(payloadSegment);
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as JwtPayload;
  } catch {
    return null;
  }
}

function sanitizeAccountIdSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return cleaned || "unknown";
}

function encodeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function resolveAccountIdFromPayload(payload: JwtPayload): string | null {
  const auth = payload[OPENAI_CODEX_AUTH_CLAIM_PATH];
  if (!auth || typeof auth !== "object") {
    return null;
  }
  const accountId = (auth as Record<string, unknown>)["chatgpt_account_id"];
  if (typeof accountId !== "string" || !accountId.trim()) {
    return null;
  }
  return accountId.trim();
}

function extractOpenAICodexIdentity(params: {
  access: string;
  accountId?: string;
}): OpenAICodexIdentity | null {
  const payload = decodeJwtPayload(params.access);
  if (!payload) {
    return null;
  }
  const iss = typeof payload["iss"] === "string" ? payload["iss"].trim() : "";
  const sub = typeof payload["sub"] === "string" ? payload["sub"].trim() : "";
  if (!iss || !sub) {
    return null;
  }
  const accountId = params.accountId?.trim() || resolveAccountIdFromPayload(payload);
  if (!accountId) {
    return null;
  }
  return { accountId, iss, sub };
}

function isOpenAICodexOAuthCredential(
  credential: OAuthCredential | { provider?: unknown; access?: unknown; accountId?: unknown },
): credential is OAuthCredential {
  if (typeof credential.provider !== "string") {
    return false;
  }
  return (
    normalizeProviderId(credential.provider) === OPENAI_CODEX_PROVIDER &&
    typeof credential.access === "string"
  );
}

export function isOpenAICodexCanonicalProfileId(profileId: string): boolean {
  const parts = profileId.split(":");
  return (
    parts.length === 4 &&
    normalizeProviderId(parts[0] ?? "") === OPENAI_CODEX_PROVIDER &&
    (parts[1] ?? "").trim().length > 0 &&
    (parts[2] ?? "").trim().length > 0 &&
    (parts[3] ?? "").trim().length > 0
  );
}

export function deriveOpenAICodexCanonicalProfileId(
  credential: OAuthCredential | { provider?: unknown; access?: unknown; accountId?: unknown },
): string | null {
  if (!isOpenAICodexOAuthCredential(credential)) {
    return null;
  }
  const identity = extractOpenAICodexIdentity({
    access: credential.access,
    accountId: typeof credential.accountId === "string" ? credential.accountId : undefined,
  });
  if (!identity) {
    return null;
  }
  const accountIdSegment = sanitizeAccountIdSegment(identity.accountId);
  return `${OPENAI_CODEX_PROVIDER}:${accountIdSegment}:${encodeSegment(identity.iss)}:${encodeSegment(identity.sub)}`;
}

function selectPreferredCredential(
  existing: OAuthCredential,
  incoming: OAuthCredential,
): OAuthCredential {
  const existingExpires = Number.isFinite(existing.expires) ? existing.expires : 0;
  const incomingExpires = Number.isFinite(incoming.expires) ? incoming.expires : 0;
  const preferIncoming = incomingExpires > existingExpires;
  const preferred = preferIncoming ? incoming : existing;
  const fallback = preferIncoming ? existing : incoming;
  return {
    ...fallback,
    ...preferred,
    type: "oauth",
    provider: OPENAI_CODEX_PROVIDER,
    ...(preferred.email || fallback.email ? { email: preferred.email ?? fallback.email } : {}),
    ...(preferred.accountId || fallback.accountId
      ? { accountId: preferred.accountId ?? fallback.accountId }
      : {}),
  };
}

function mergeUsageStats(base: ProfileUsageStats, incoming: ProfileUsageStats): ProfileUsageStats {
  const maxValue = (a?: number, b?: number): number | undefined => {
    const values = [a, b].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (values.length === 0) {
      return undefined;
    }
    return Math.max(...values);
  };
  const mergedFailureCounts = {
    ...base.failureCounts,
    ...incoming.failureCounts,
  } as NonNullable<ProfileUsageStats["failureCounts"]>;
  for (const [reason, count] of Object.entries(incoming.failureCounts ?? {})) {
    const key = reason as keyof typeof mergedFailureCounts;
    const current = mergedFailureCounts[key];
    if (typeof count === "number" && Number.isFinite(count)) {
      mergedFailureCounts[key] =
        typeof current === "number" && Number.isFinite(current) ? Math.max(current, count) : count;
    }
  }
  return {
    ...base,
    ...incoming,
    lastUsed: maxValue(base.lastUsed, incoming.lastUsed),
    cooldownUntil: maxValue(base.cooldownUntil, incoming.cooldownUntil),
    disabledUntil: maxValue(base.disabledUntil, incoming.disabledUntil),
    errorCount: maxValue(base.errorCount, incoming.errorCount),
    lastFailureAt: maxValue(base.lastFailureAt, incoming.lastFailureAt),
    disabledReason: incoming.disabledReason ?? base.disabledReason,
    failureCounts: Object.keys(mergedFailureCounts).length > 0 ? mergedFailureCounts : undefined,
  };
}

function remapOrder(
  order: Record<string, string[]> | undefined,
  mapping: Record<string, string>,
): boolean {
  if (!order) {
    return false;
  }
  let changed = false;
  for (const [provider, ids] of Object.entries(order)) {
    const next = dedupeProfileIds(ids.map((id) => mapping[id] ?? id));
    if (next.length !== ids.length || next.some((value, index) => value !== ids[index])) {
      order[provider] = next;
      changed = true;
    }
  }
  return changed;
}

function remapLastGood(
  lastGood: Record<string, string> | undefined,
  mapping: Record<string, string>,
): boolean {
  if (!lastGood) {
    return false;
  }
  let changed = false;
  for (const [provider, profileId] of Object.entries(lastGood)) {
    const mapped = mapping[profileId];
    if (!mapped || mapped === profileId) {
      continue;
    }
    lastGood[provider] = mapped;
    changed = true;
  }
  return changed;
}

function remapUsageStats(
  usageStats: Record<string, ProfileUsageStats> | undefined,
  mapping: Record<string, string>,
): boolean {
  if (!usageStats) {
    return false;
  }
  let changed = false;
  for (const [fromProfileId, toProfileId] of Object.entries(mapping)) {
    if (fromProfileId === toProfileId) {
      continue;
    }
    const fromStats = usageStats[fromProfileId];
    if (!fromStats) {
      continue;
    }
    const toStats = usageStats[toProfileId];
    usageStats[toProfileId] = toStats ? mergeUsageStats(toStats, fromStats) : fromStats;
    delete usageStats[fromProfileId];
    changed = true;
  }
  return changed;
}

export function migrateOpenAICodexProfileIdsInStore(store: AuthProfileStore): {
  mutated: boolean;
  mapping: Record<string, string>;
} {
  const mapping: Record<string, string> = {};
  let mutated = false;
  const snapshot = Object.entries(store.profiles);
  for (const [profileId, rawCredential] of snapshot) {
    if (profileId === OPENAI_CODEX_DEPRECATED_PROFILE_ID) {
      continue;
    }
    if (rawCredential.type !== "oauth") {
      continue;
    }
    if (normalizeProviderId(String(rawCredential.provider ?? "")) !== OPENAI_CODEX_PROVIDER) {
      continue;
    }
    const canonicalProfileId = deriveOpenAICodexCanonicalProfileId(rawCredential);
    if (!canonicalProfileId || canonicalProfileId === profileId) {
      continue;
    }
    mapping[profileId] = canonicalProfileId;
    const existing = store.profiles[canonicalProfileId];
    if (
      existing?.type === "oauth" &&
      normalizeProviderId(String(existing.provider ?? "")) === OPENAI_CODEX_PROVIDER
    ) {
      store.profiles[canonicalProfileId] = selectPreferredCredential(existing, rawCredential);
    } else {
      store.profiles[canonicalProfileId] = { ...rawCredential };
    }
    delete store.profiles[profileId];
    mutated = true;
  }

  if (Object.keys(mapping).length === 0) {
    return { mutated, mapping };
  }

  mutated = remapOrder(store.order, mapping) || mutated;
  mutated = remapLastGood(store.lastGood, mapping) || mutated;
  mutated = remapUsageStats(store.usageStats, mapping) || mutated;

  return { mutated, mapping };
}

function looksEmailLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.includes("@") && trimmed.includes(".");
}

function getProfileSuffix(profileId: string): string {
  const idx = profileId.indexOf(":");
  if (idx < 0) {
    return "";
  }
  return profileId.slice(idx + 1);
}

function listOpenAICodexOAuthProfiles(store: AuthProfileStore): string[] {
  return listProfilesForProvider(store, OPENAI_CODEX_PROVIDER).filter(
    (id) => store.profiles[id]?.type === "oauth",
  );
}

export function resolveOpenAICodexCompatibleProfileId(params: {
  store: AuthProfileStore;
  profileId: string;
  cfg?: OpenClawConfig;
}): string | null {
  if (params.store.profiles[params.profileId]) {
    return params.profileId;
  }
  if (!params.profileId.startsWith(`${OPENAI_CODEX_PROVIDER}:`)) {
    return null;
  }
  const oauthProfiles = listOpenAICodexOAuthProfiles(params.store);
  if (oauthProfiles.length === 0) {
    return null;
  }
  const canonicalProfiles = oauthProfiles.filter((id) => isOpenAICodexCanonicalProfileId(id));

  const profileCfg = params.cfg?.auth?.profiles?.[params.profileId];
  const cfgEmail = profileCfg?.email?.trim();
  const suffix = getProfileSuffix(params.profileId);
  const suffixEmail = looksEmailLike(suffix) ? suffix : undefined;
  const candidateEmail = cfgEmail || suffixEmail;
  if (candidateEmail) {
    const byEmail = oauthProfiles.find((id) => {
      const cred = params.store.profiles[id];
      return cred?.type === "oauth" && cred.email?.trim() === candidateEmail;
    });
    if (byEmail) {
      return byEmail;
    }
  }

  const lastGood = params.store.lastGood?.[OPENAI_CODEX_PROVIDER];
  if (lastGood && oauthProfiles.includes(lastGood)) {
    return lastGood;
  }

  if (canonicalProfiles.length === 1) {
    return canonicalProfiles[0] ?? null;
  }
  if (oauthProfiles.length === 1) {
    return oauthProfiles[0] ?? null;
  }
  return null;
}

type OpenAICodexProfileConfigRepairResult = {
  config: OpenClawConfig;
  changes: string[];
  migrated: boolean;
  mapping: Record<string, string>;
};

function remapConfigOrder(
  order: Record<string, string[]> | undefined,
  mapping: Record<string, string>,
): Record<string, string[]> | undefined {
  if (!order) {
    return undefined;
  }
  const nextOrder: Record<string, string[]> = {};
  for (const [provider, profileIds] of Object.entries(order)) {
    const mapped = dedupeProfileIds(profileIds.map((id) => mapping[id] ?? id));
    if (mapped.length > 0) {
      nextOrder[provider] = mapped;
    }
  }
  return Object.keys(nextOrder).length > 0 ? nextOrder : undefined;
}

export function repairOpenAICodexOAuthProfileIdsInConfig(params: {
  cfg: OpenClawConfig;
  store: AuthProfileStore;
}): OpenAICodexProfileConfigRepairResult {
  const authProfiles = params.cfg.auth?.profiles;
  if (!authProfiles || Object.keys(authProfiles).length === 0) {
    return { config: params.cfg, changes: [], migrated: false, mapping: {} };
  }

  const mapping: Record<string, string> = {};
  for (const [profileId, profileConfig] of Object.entries(authProfiles)) {
    if (normalizeProviderId(profileConfig.provider) !== OPENAI_CODEX_PROVIDER) {
      continue;
    }
    if (profileConfig.mode !== "oauth") {
      continue;
    }
    const storeCredential = params.store.profiles[profileId];
    const canonicalFromStore =
      storeCredential?.type === "oauth"
        ? deriveOpenAICodexCanonicalProfileId(storeCredential)
        : null;
    if (canonicalFromStore && canonicalFromStore !== profileId) {
      mapping[profileId] = canonicalFromStore;
      continue;
    }
    if (!storeCredential) {
      const compatible = resolveOpenAICodexCompatibleProfileId({
        cfg: params.cfg,
        store: params.store,
        profileId,
      });
      if (compatible && compatible !== profileId) {
        mapping[profileId] = compatible;
      }
    }
  }

  if (Object.keys(mapping).length === 0) {
    return { config: params.cfg, changes: [], migrated: false, mapping: {} };
  }

  const nextProfiles = {
    ...params.cfg.auth?.profiles,
  } as Record<string, AuthProfileConfig>;
  for (const [fromProfileId, toProfileId] of Object.entries(mapping)) {
    const from = nextProfiles[fromProfileId];
    if (!from) {
      continue;
    }
    const existing = nextProfiles[toProfileId];
    const toCredential = params.store.profiles[toProfileId];
    const toEmail = toCredential?.type === "oauth" ? toCredential.email?.trim() : undefined;
    const resolvedEmail = existing?.email?.trim() || from.email?.trim() || toEmail;
    nextProfiles[toProfileId] = {
      ...(existing ?? from),
      provider: OPENAI_CODEX_PROVIDER,
      mode: "oauth",
      ...(resolvedEmail ? { email: resolvedEmail } : {}),
    };
    delete nextProfiles[fromProfileId];
  }

  const nextOrder = remapConfigOrder(params.cfg.auth?.order, mapping);
  const nextCfg: OpenClawConfig = {
    ...params.cfg,
    auth: {
      ...params.cfg.auth,
      profiles: nextProfiles,
      ...(nextOrder ? { order: nextOrder } : {}),
    },
  };
  const changes = Object.entries(mapping).map(
    ([fromProfileId, toProfileId]) =>
      `Auth: migrate ${fromProfileId} → ${toProfileId} (OpenAI OIDC profile id)`,
  );
  return {
    config: nextCfg,
    changes,
    migrated: true,
    mapping,
  };
}
