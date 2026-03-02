import util from "node:util";
import { createAccountActionGate } from "../channels/plugins/account-action-gate.js";
import { createAccountListHelpers } from "../channels/plugins/account-helpers.js";
import type { OpenClawConfig } from "../config/config.js";
import type { TelegramAccountConfig, TelegramActionConfig } from "../config/types.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAccountWithDefaultFallback } from "../plugin-sdk/account-resolution.js";
import { resolveAccountEntry } from "../routing/account-lookup.js";
import { resolveDefaultAgentBoundAccountId } from "../routing/bindings.js";
import { formatSetExplicitDefaultInstruction } from "../routing/default-account-warnings.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "../routing/session-key.js";
import { resolveTelegramToken } from "./token.js";

const log = createSubsystemLogger("telegram/accounts");

function formatDebugArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  return util.inspect(value, { colors: false, depth: null, compact: true, breakLength: Infinity });
}

const debugAccounts = (...args: unknown[]) => {
  if (isTruthyEnvValue(process.env.OPENCLAW_DEBUG_TELEGRAM_ACCOUNTS)) {
    const parts = args.map((arg) => formatDebugArg(arg));
    log.warn(parts.join(" ").trim());
  }
};

export type ResolvedTelegramAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  config: TelegramAccountConfig;
};

function hasBaseLevelTelegramToken(cfg: OpenClawConfig): boolean {
  const tg = cfg.channels?.telegram;
  if (!tg) {
    return false;
  }
  // Check all config-level token sources that indicate the default account is
  // declared. tokenFile is a config declaration (the user intends a default
  // account to exist); runtime file-not-found is a separate error.
  return (
    Boolean((tg as { botToken?: string }).botToken?.trim()) ||
    Boolean((tg as { tokenFile?: string }).tokenFile?.trim()) ||
    Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())
  );
}

// Account listing/default resolution consolidated into the shared helper.
// Thin wrappers preserve the exported API and Telegram-specific debug logging.
const _helpers = createAccountListHelpers("telegram", {
  hasBaseLevelToken: hasBaseLevelTelegramToken,
});

export function listTelegramAccountIds(cfg: OpenClawConfig): string[] {
  const ids = _helpers.listAccountIds(cfg);
  debugAccounts("listTelegramAccountIds", ids);
  return ids;
}

let emittedMissingDefaultWarn = false;

/** @internal Reset the once-per-process warning flag. Exported for tests only. */
export function resetMissingDefaultWarnFlag(): void {
  emittedMissingDefaultWarn = false;
}

export function resolveDefaultTelegramAccountId(cfg: OpenClawConfig): string {
  const resolved = _helpers.resolveDefaultAccountId(cfg);
  const preferred = normalizeOptionalAccountId(cfg.channels?.telegram?.defaultAccount);
  const ids = listTelegramAccountIds(cfg);
  const resolvedNormalized = normalizeAccountId(resolved);
  const hasPreferred =
    Boolean(preferred) && ids.some((accountId) => normalizeAccountId(accountId) === preferred);
  const boundDefault = resolveDefaultAgentBoundAccountId(cfg, "telegram");
  const usesBoundDefault = Boolean(boundDefault && boundDefault === resolvedNormalized);
  const usesPreferredDefault = Boolean(preferred && hasPreferred && preferred === resolvedNormalized);

  if (ids.length > 1 && !emittedMissingDefaultWarn) {
    const fallbackWithoutExplicitOrBound =
      !ids.includes(DEFAULT_ACCOUNT_ID) && !usesPreferredDefault && !usesBoundDefault;
    if (fallbackWithoutExplicitOrBound) {
      emittedMissingDefaultWarn = true;
      log.warn(
        `channels.telegram: accounts.default is missing; falling back to "${resolved}". ` +
          `${formatSetExplicitDefaultInstruction("telegram")} to avoid routing surprises in multi-account setups.`,
      );
    }
  }
  return resolved;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramAccountConfig | undefined {
  const normalized = normalizeAccountId(accountId);
  return resolveAccountEntry(cfg.channels?.telegram?.accounts, normalized);
}

function mergeTelegramAccountConfig(cfg: OpenClawConfig, accountId: string): TelegramAccountConfig {
  const {
    accounts: _ignored,
    defaultAccount: _ignoredDefaultAccount,
    groups: channelGroups,
    ...base
  } = (cfg.channels?.telegram ?? {}) as TelegramAccountConfig & {
    accounts?: unknown;
    defaultAccount?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};

  // In multi-account setups, channel-level `groups` must NOT be inherited by
  // accounts that don't have their own `groups` config.  A bot that is not a
  // member of a configured group will fail when handling group messages, and
  // this failure disrupts message delivery for *all* accounts.
  // Single-account setups keep backward compat: channel-level groups still
  // applies when the account has no override.
  // See: https://github.com/openclaw/openclaw/issues/30673
  const configuredAccountIds = Object.keys(cfg.channels?.telegram?.accounts ?? {});
  const isMultiAccount = configuredAccountIds.length > 1;
  const groups = account.groups ?? (isMultiAccount ? undefined : channelGroups);

  return { ...base, ...account, groups };
}

export function createTelegramActionGate(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): (key: keyof TelegramActionConfig, defaultValue?: boolean) => boolean {
  const accountId = normalizeAccountId(params.accountId);
  return createAccountActionGate({
    baseActions: params.cfg.channels?.telegram?.actions,
    accountActions: resolveAccountConfig(params.cfg, accountId)?.actions,
  });
}

export function resolveTelegramAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedTelegramAccount {
  const baseEnabled = params.cfg.channels?.telegram?.enabled !== false;

  const resolve = (accountId: string) => {
    const merged = mergeTelegramAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const tokenResolution = resolveTelegramToken(params.cfg, { accountId });
    debugAccounts("resolve", {
      accountId,
      enabled,
      tokenSource: tokenResolution.source,
    });
    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      token: tokenResolution.token,
      tokenSource: tokenResolution.source,
      config: merged,
    } satisfies ResolvedTelegramAccount;
  };

  // If accountId is omitted, prefer a configured account token over failing on
  // the implicit "default" account. This keeps env-based setups working while
  // making config-only tokens work for things like heartbeats.
  return resolveAccountWithDefaultFallback({
    accountId: params.accountId,
    normalizeAccountId,
    resolvePrimary: resolve,
    hasCredential: (account) => account.tokenSource !== "none",
    resolveDefaultAccountId: () => resolveDefaultTelegramAccountId(params.cfg),
  });
}

export function listEnabledTelegramAccounts(cfg: OpenClawConfig): ResolvedTelegramAccount[] {
  return listTelegramAccountIds(cfg)
    .map((accountId) => resolveTelegramAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
