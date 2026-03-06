import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { AuthProfileStore, OAuthCredential } from "./auth-profiles.js";
import {
  deriveOpenAICodexCanonicalProfileId,
  migrateOpenAICodexProfileIdsInStore,
  repairOpenAICodexOAuthProfileIdsInConfig,
  resolveOpenAICodexCompatibleProfileId,
} from "./auth-profiles/openai-codex-profile-id.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${header}.${body}.sig`;
}

function makeOpenAICredential(params: {
  accountId: string;
  iss: string;
  sub: string;
  email?: string;
  expires?: number;
}): OAuthCredential {
  return {
    type: "oauth",
    provider: "openai-codex",
    access: makeJwt({
      iss: params.iss,
      sub: params.sub,
      "https://api.openai.com/auth": {
        chatgpt_account_id: params.accountId,
      },
    }),
    refresh: `refresh-${params.accountId}`,
    expires: params.expires ?? Date.now() + 60_000,
    accountId: params.accountId,
    ...(params.email ? { email: params.email } : {}),
  };
}

describe("openai-codex profile id canonicalization", () => {
  it("derives canonical profile id from accountId + iss + sub", () => {
    const id = deriveOpenAICodexCanonicalProfileId(
      makeOpenAICredential({
        accountId: "acct_123",
        iss: "https://auth.openai.com",
        sub: "user_456",
      }),
    );
    expect(id).toBe(
      `openai-codex:acct_123:${Buffer.from("https://auth.openai.com", "utf8").toString("base64url")}:${Buffer.from("user_456", "utf8").toString("base64url")}`,
    );
  });

  it("migrates legacy openai-codex profile ids and remaps store references", () => {
    const canonicalCredential = makeOpenAICredential({
      accountId: "acct_abc",
      iss: "https://auth.openai.com",
      sub: "sub_abc",
      email: "user@example.com",
    });
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai-codex:user@example.com": canonicalCredential,
      },
      order: {
        "openai-codex": ["openai-codex:user@example.com"],
      },
      lastGood: {
        "openai-codex": "openai-codex:user@example.com",
      },
      usageStats: {
        "openai-codex:user@example.com": {
          lastUsed: 42,
          errorCount: 2,
        },
      },
    };

    const migrated = migrateOpenAICodexProfileIdsInStore(store);

    const canonicalProfileId = deriveOpenAICodexCanonicalProfileId(canonicalCredential);
    expect(canonicalProfileId).toBeTruthy();
    expect(migrated.mutated).toBe(true);
    expect(migrated.mapping).toEqual({
      "openai-codex:user@example.com": canonicalProfileId,
    });
    expect(store.profiles["openai-codex:user@example.com"]).toBeUndefined();
    expect(store.profiles[canonicalProfileId!]).toMatchObject({
      provider: "openai-codex",
      type: "oauth",
      accountId: "acct_abc",
    });
    expect(store.order?.["openai-codex"]).toEqual([canonicalProfileId]);
    expect(store.lastGood?.["openai-codex"]).toBe(canonicalProfileId);
    expect(store.usageStats?.["openai-codex:user@example.com"]).toBeUndefined();
    expect(store.usageStats?.[canonicalProfileId!]?.lastUsed).toBe(42);
  });

  it("rewrites config profile references to canonical openai-codex ids", () => {
    const credential = makeOpenAICredential({
      accountId: "acct_cfg",
      iss: "https://auth.openai.com",
      sub: "sub_cfg",
      email: "cfg@example.com",
    });
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai-codex:cfg@example.com": credential,
      },
      order: {
        "openai-codex": ["openai-codex:cfg@example.com"],
      },
    };
    const migratedStore = migrateOpenAICodexProfileIdsInStore(store);
    expect(migratedStore.mutated).toBe(true);

    const cfg: OpenClawConfig = {
      auth: {
        profiles: {
          "openai-codex:cfg@example.com": {
            provider: "openai-codex",
            mode: "oauth",
            email: "cfg@example.com",
          },
        },
        order: {
          "openai-codex": ["openai-codex:cfg@example.com"],
        },
      },
    };

    const repair = repairOpenAICodexOAuthProfileIdsInConfig({ cfg, store });
    const canonicalProfileId = Object.keys(store.profiles).find((id) =>
      id.startsWith("openai-codex:"),
    );
    expect(canonicalProfileId).toBeTruthy();
    expect(repair.migrated).toBe(true);
    expect(repair.config.auth?.profiles?.[canonicalProfileId!]).toMatchObject({
      provider: "openai-codex",
      mode: "oauth",
    });
    expect(repair.config.auth?.profiles?.["openai-codex:cfg@example.com"]).toBeUndefined();
    expect(repair.config.auth?.order?.["openai-codex"]).toEqual([canonicalProfileId]);
  });

  it("resolves legacy openai-codex profile id to canonical profile id", () => {
    const credential = makeOpenAICredential({
      accountId: "acct_legacy",
      iss: "https://auth.openai.com",
      sub: "sub_legacy",
      email: "legacy@example.com",
    });
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai-codex:legacy@example.com": credential,
      },
    };
    migrateOpenAICodexProfileIdsInStore(store);

    const resolved = resolveOpenAICodexCompatibleProfileId({
      store,
      profileId: "openai-codex:legacy@example.com",
      cfg: {
        auth: {
          profiles: {
            "openai-codex:legacy@example.com": {
              provider: "openai-codex",
              mode: "oauth",
              email: "legacy@example.com",
            },
          },
        },
      },
    });

    expect(resolved).toBeTruthy();
    expect(resolved).not.toBe("openai-codex:legacy@example.com");
  });
});
