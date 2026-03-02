import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { createAccountListHelpers } from "./account-helpers.js";

const { listConfiguredAccountIds, listAccountIds, resolveDefaultAccountId } =
  createAccountListHelpers("testchannel");

function cfg(accounts?: Record<string, unknown> | null, defaultAccount?: string): OpenClawConfig {
  if (accounts === null) {
    return {
      channels: {
        testchannel: defaultAccount ? { defaultAccount } : {},
      },
    } as unknown as OpenClawConfig;
  }
  if (accounts === undefined && !defaultAccount) {
    return {} as unknown as OpenClawConfig;
  }
  return {
    channels: {
      testchannel: {
        ...(accounts === undefined ? {} : { accounts }),
        ...(defaultAccount ? { defaultAccount } : {}),
      },
    },
  } as unknown as OpenClawConfig;
}

function cfgWithBindings(
  accounts: Record<string, unknown> | null | undefined,
  bindings: Array<{
    agentId?: string;
    match: {
      channel: string;
      accountId: string;
      guildId?: string;
      teamId?: string;
      peer?: { kind: string; id: string };
      roles?: string[];
    };
  }>,
): OpenClawConfig {
  const base = cfg(accounts);
  return { ...base, bindings } as unknown as OpenClawConfig;
}

describe("createAccountListHelpers", () => {
  describe("listConfiguredAccountIds", () => {
    it("returns empty for missing config", () => {
      expect(listConfiguredAccountIds({} as OpenClawConfig)).toEqual([]);
    });

    it("returns empty when no accounts key", () => {
      expect(listConfiguredAccountIds(cfg(null))).toEqual([]);
    });

    it("returns empty for empty accounts object", () => {
      expect(listConfiguredAccountIds(cfg({}))).toEqual([]);
    });

    it("filters out empty keys", () => {
      expect(listConfiguredAccountIds(cfg({ "": {}, a: {} }))).toEqual(["a"]);
    });

    it("returns account keys", () => {
      expect(listConfiguredAccountIds(cfg({ work: {}, personal: {} }))).toContain("work");
      expect(listConfiguredAccountIds(cfg({ work: {}, personal: {} }))).toContain("personal");
    });

    it("preserves original casing of account keys", () => {
      const ids = listConfiguredAccountIds(cfg({ Work: {}, PERSONAL: {} }));
      expect(ids).toContain("Work");
      expect(ids).toContain("PERSONAL");
    });

    it("deduplicates case-insensitively, keeping first-seen variant", () => {
      // "Work" and "work" are distinct JS keys but collide case-insensitively.
      // Dedup keeps first-seen ("Work"), skips "work".
      const ids = listConfiguredAccountIds(cfg({ Work: {}, work: {} }));
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe("Work");
    });
  });

  describe("listAccountIds", () => {
    it('returns ["default"] for empty config', () => {
      expect(listAccountIds({} as OpenClawConfig)).toEqual(["default"]);
    });

    it('returns ["default"] for empty accounts', () => {
      expect(listAccountIds(cfg({}))).toEqual(["default"]);
    });

    it("returns sorted ids", () => {
      expect(listAccountIds(cfg({ z: {}, a: {}, m: {} }))).toEqual(["a", "m", "z"]);
    });

    it("does NOT include bound account IDs that are not configured", () => {
      // Binding-declared accounts must NOT appear unless they exist in config —
      // phantom accounts cause missing-token errors rather than silent failures.
      const config = cfgWithBindings({ myaccount: {} }, [
        { agentId: "main", match: { channel: "testchannel", accountId: "ghostaccount" } },
      ]);
      const ids = listAccountIds(config);
      expect(ids).not.toContain("ghostaccount");
      expect(ids).toContain("myaccount");
    });
  });

  describe("resolveDefaultAccountId", () => {
    it("prefers configured defaultAccount when it matches a configured account id", () => {
      expect(resolveDefaultAccountId(cfg({ alpha: {}, beta: {} }, "beta"))).toBe("beta");
    });

    it("normalizes configured defaultAccount before matching", () => {
      expect(resolveDefaultAccountId(cfg({ "router-d": {} }, "Router D"))).toBe("router-d");
    });

    it("falls back when configured defaultAccount is missing", () => {
      expect(resolveDefaultAccountId(cfg({ beta: {}, alpha: {} }, "missing"))).toBe("alpha");
    });

    it('returns "default" when present', () => {
      expect(resolveDefaultAccountId(cfg({ default: {}, other: {} }))).toBe("default");
    });

    it("returns first sorted id when no default", () => {
      expect(resolveDefaultAccountId(cfg({ beta: {}, alpha: {} }))).toBe("alpha");
    });

    it('returns "default" for empty config', () => {
      expect(resolveDefaultAccountId({} as OpenClawConfig)).toBe("default");
    });

    it("returns the bound account when it exists in configured accounts", () => {
      // The default agent (main) is bound to "workaccount" on testchannel —
      // and "workaccount" is in configured accounts, so use it.
      const config = cfgWithBindings({ workaccount: {}, otheraccount: {} }, [
        { agentId: "main", match: { channel: "testchannel", accountId: "workaccount" } },
      ]);
      expect(resolveDefaultAccountId(config)).toBe("workaccount");
    });

    it("falls back to normal resolution when bound account is not configured", () => {
      // The binding references "ghostaccount" which is not in configured accounts.
      // The helper should NOT silently return the phantom account; instead it falls
      // back so the missing-token error surfaces at runtime.
      const config = cfgWithBindings({ alpha: {}, beta: {} }, [
        { agentId: "main", match: { channel: "testchannel", accountId: "ghostaccount" } },
      ]);
      // Falls back: "alpha" is first alphabetically
      expect(resolveDefaultAccountId(config)).toBe("alpha");
    });

    it("uses bound 'default' when no named accounts are configured", () => {
      // No accounts key means implicit "default" mode. A binding to "default" is
      // valid; bindings to other IDs would break token resolution for channels
      // using top-level credentials (e.g. channels.discord.token).
      const config = cfgWithBindings(undefined, [
        { agentId: "main", match: { channel: "testchannel", accountId: "default" } },
      ]);
      expect(resolveDefaultAccountId(config)).toBe("default");
    });

    it("ignores bound non-default account when no named accounts are configured", () => {
      // A stale binding to "work" with no named accounts should NOT override
      // the implicit "default" — "work" has no token in implicit mode.
      const config = cfgWithBindings(undefined, [
        { agentId: "main", match: { channel: "testchannel", accountId: "work" } },
      ]);
      expect(resolveDefaultAccountId(config)).toBe("default");
    });

    it("ignores scoped bindings (guildId) when resolving global default", () => {
      // A guild-scoped binding should NOT influence the global default account.
      const config = cfgWithBindings({ alpha: {}, beta: {} }, [
        {
          agentId: "main",
          match: { channel: "testchannel", accountId: "beta", guildId: "12345" },
        },
      ]);
      // "beta" is guild-scoped — ignored. Falls back to "alpha" (first sorted).
      expect(resolveDefaultAccountId(config)).toBe("alpha");
    });

    it("ignores scoped bindings (peer) when resolving global default", () => {
      const config = cfgWithBindings({ alpha: {}, beta: {} }, [
        {
          agentId: "main",
          match: {
            channel: "testchannel",
            accountId: "beta",
            peer: { kind: "direct", id: "user123" },
          },
        },
      ]);
      expect(resolveDefaultAccountId(config)).toBe("alpha");
    });

    it("matches bound account with special characters in config key", () => {
      // Config key "my.bot" lowercases to "my.bot", but the binding normalizes
      // "my.bot" to "my-bot" (dots replaced with dashes). The comparison must
      // normalize both sides so the bound account is recognized. The return
      // value is the configured key ("my.bot"), not the normalized form
      // ("my-bot"), so downstream resolveAccountEntry() can find the original
      // config entry via case-insensitive lookup.
      const config = cfgWithBindings({ "my.bot": {}, other: {} }, [
        { agentId: "main", match: { channel: "testchannel", accountId: "my.bot" } },
      ]);
      expect(resolveDefaultAccountId(config)).toBe("my.bot");
    });

    it("uses unscoped binding even when scoped bindings exist", () => {
      const config = cfgWithBindings({ alpha: {}, beta: {} }, [
        {
          agentId: "main",
          match: { channel: "testchannel", accountId: "alpha", guildId: "12345" },
        },
        { agentId: "main", match: { channel: "testchannel", accountId: "beta" } },
      ]);
      // First binding is scoped (skip), second is unscoped — use "beta".
      expect(resolveDefaultAccountId(config)).toBe("beta");
    });
  });

  describe("hasBaseLevelToken (mixed mode)", () => {
    // Create a separate helper instance with hasBaseLevelToken to test mixed mode.
    // In mixed mode, named accounts exist alongside a base-level token that makes
    // the implicit "default" account valid.
    let hasToken = false;
    const mixed = createAccountListHelpers("testchannel", {
      hasBaseLevelToken: () => hasToken,
    });

    it("includes 'default' alongside named accounts when hasBaseLevelToken returns true", () => {
      hasToken = true;
      expect(mixed.listAccountIds(cfg({ work: {} }))).toEqual(["default", "work"]);
    });

    it("excludes 'default' when hasBaseLevelToken returns false", () => {
      hasToken = false;
      expect(mixed.listAccountIds(cfg({ work: {} }))).toEqual(["work"]);
    });

    it("resolves bound 'default' when hasBaseLevelToken is true", () => {
      hasToken = true;
      const config = cfgWithBindings({ work: {} }, [
        { agentId: "main", match: { channel: "testchannel", accountId: "default" } },
      ]);
      expect(mixed.resolveDefaultAccountId(config)).toBe("default");
    });

    it("rejects bound 'default' when hasBaseLevelToken is false", () => {
      hasToken = false;
      const config = cfgWithBindings({ work: {} }, [
        { agentId: "main", match: { channel: "testchannel", accountId: "default" } },
      ]);
      // "default" not in ["work"] → falls back to "work"
      expect(mixed.resolveDefaultAccountId(config)).toBe("work");
    });
  });
});
