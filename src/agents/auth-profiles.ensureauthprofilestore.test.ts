import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { AUTH_STORE_VERSION, log } from "./auth-profiles/constants.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${header}.${body}.sig`;
}

function expectedOpenAICodexProfileId(params: {
  accountId: string;
  iss: string;
  sub: string;
}): string {
  return `openai-codex:${params.accountId}:${Buffer.from(params.iss, "utf8").toString("base64url")}:${Buffer.from(params.sub, "utf8").toString("base64url")}`;
}

describe("ensureAuthProfileStore", () => {
  it("migrates legacy auth.json and deletes it (PR #368)", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-profiles-"));
    try {
      const legacyPath = path.join(agentDir, "auth.json");
      fs.writeFileSync(
        legacyPath,
        `${JSON.stringify(
          {
            anthropic: {
              type: "oauth",
              provider: "anthropic",
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 60_000,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles["anthropic:default"]).toMatchObject({
        type: "oauth",
        provider: "anthropic",
      });

      const migratedPath = path.join(agentDir, "auth-profiles.json");
      expect(fs.existsSync(migratedPath)).toBe(true);
      expect(fs.existsSync(legacyPath)).toBe(false);

      // idempotent
      const store2 = ensureAuthProfileStore(agentDir);
      expect(store2.profiles["anthropic:default"]).toBeDefined();
      expect(fs.existsSync(legacyPath)).toBe(false);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("migrates legacy openai-codex profile ids to canonical oidc ids", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-openai-migrate-"));
    try {
      const legacyProfileId = "openai-codex:user@example.com";
      const canonicalProfileId = expectedOpenAICodexProfileId({
        accountId: "acct-openai",
        iss: "https://auth.openai.com",
        sub: "sub-openai",
      });
      const storeData = {
        version: AUTH_STORE_VERSION,
        profiles: {
          [legacyProfileId]: {
            type: "oauth",
            provider: "openai-codex",
            access: makeJwt({
              iss: "https://auth.openai.com",
              sub: "sub-openai",
              "https://api.openai.com/auth": { chatgpt_account_id: "acct-openai" },
            }),
            refresh: "refresh-openai",
            expires: Date.now() + 60_000,
            email: "user@example.com",
            accountId: "acct-openai",
          },
        },
        order: {
          "openai-codex": [legacyProfileId],
        },
        lastGood: {
          "openai-codex": legacyProfileId,
        },
        usageStats: {
          [legacyProfileId]: {
            lastUsed: 123,
            errorCount: 2,
          },
        },
      };
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(storeData, null, 2)}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles[legacyProfileId]).toBeUndefined();
      expect(store.profiles[canonicalProfileId]).toMatchObject({
        provider: "openai-codex",
        type: "oauth",
        accountId: "acct-openai",
      });
      expect(store.order?.["openai-codex"]).toEqual([canonicalProfileId]);
      expect(store.lastGood?.["openai-codex"]).toBe(canonicalProfileId);
      expect(store.usageStats?.[legacyProfileId]).toBeUndefined();
      expect(store.usageStats?.[canonicalProfileId]?.lastUsed).toBe(123);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("merges main auth profiles into agent store and keeps agent overrides", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-merge-"));
    const previousAgentDir = process.env.OPENCLAW_AGENT_DIR;
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    try {
      const mainDir = path.join(root, "main-agent");
      const agentDir = path.join(root, "agent-x");
      fs.mkdirSync(mainDir, { recursive: true });
      fs.mkdirSync(agentDir, { recursive: true });

      process.env.OPENCLAW_AGENT_DIR = mainDir;
      process.env.PI_CODING_AGENT_DIR = mainDir;

      const mainStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "main-key",
          },
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "main-anthropic-key",
          },
        },
      };
      fs.writeFileSync(
        path.join(mainDir, "auth-profiles.json"),
        `${JSON.stringify(mainStore, null, 2)}\n`,
        "utf8",
      );

      const agentStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "agent-key",
          },
        },
      };
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(agentStore, null, 2)}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles["anthropic:default"]).toMatchObject({
        type: "api_key",
        provider: "anthropic",
        key: "main-anthropic-key",
      });
      expect(store.profiles["openai:default"]).toMatchObject({
        type: "api_key",
        provider: "openai",
        key: "agent-key",
      });
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.OPENCLAW_AGENT_DIR;
      } else {
        process.env.OPENCLAW_AGENT_DIR = previousAgentDir;
      }
      if (previousPiAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes auth-profiles credential aliases with canonical-field precedence", () => {
    const cases = [
      {
        name: "mode/apiKey aliases map to type/key",
        profile: {
          provider: "anthropic",
          mode: "api_key",
          apiKey: "sk-ant-alias", // pragma: allowlist secret
        },
        expected: {
          type: "api_key",
          key: "sk-ant-alias",
        },
      },
      {
        name: "canonical type overrides conflicting mode alias",
        profile: {
          provider: "anthropic",
          type: "api_key",
          mode: "token",
          key: "sk-ant-canonical",
        },
        expected: {
          type: "api_key",
          key: "sk-ant-canonical",
        },
      },
      {
        name: "canonical key overrides conflicting apiKey alias",
        profile: {
          provider: "anthropic",
          type: "api_key",
          key: "sk-ant-canonical",
          apiKey: "sk-ant-alias", // pragma: allowlist secret
        },
        expected: {
          type: "api_key",
          key: "sk-ant-canonical",
        },
      },
      {
        name: "canonical profile shape remains unchanged",
        profile: {
          provider: "anthropic",
          type: "api_key",
          key: "sk-ant-direct",
        },
        expected: {
          type: "api_key",
          key: "sk-ant-direct",
        },
      },
    ] as const;

    for (const testCase of cases) {
      const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-alias-"));
      try {
        const storeData = {
          version: AUTH_STORE_VERSION,
          profiles: {
            "anthropic:work": testCase.profile,
          },
        };
        fs.writeFileSync(
          path.join(agentDir, "auth-profiles.json"),
          `${JSON.stringify(storeData, null, 2)}\n`,
          "utf8",
        );

        const store = ensureAuthProfileStore(agentDir);
        expect(store.profiles["anthropic:work"], testCase.name).toMatchObject(testCase.expected);
      } finally {
        fs.rmSync(agentDir, { recursive: true, force: true });
      }
    }
  });

  it("normalizes mode/apiKey aliases while migrating legacy auth.json", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-legacy-alias-"));
    try {
      fs.writeFileSync(
        path.join(agentDir, "auth.json"),
        `${JSON.stringify(
          {
            anthropic: {
              provider: "anthropic",
              mode: "api_key",
              apiKey: "sk-ant-legacy", // pragma: allowlist secret
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles["anthropic:default"]).toMatchObject({
        type: "api_key",
        provider: "anthropic",
        key: "sk-ant-legacy",
      });
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("logs one warning with aggregated reasons for rejected auth-profiles entries", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-invalid-"));
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      const invalidStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "anthropic:missing-type": {
            provider: "anthropic",
          },
          "openai:missing-provider": {
            type: "api_key",
            key: "sk-openai",
          },
          "qwen:not-object": "broken",
        },
      };
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(invalidStore, null, 2)}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "ignored invalid auth profile entries during store load",
        {
          source: "auth-profiles.json",
          dropped: 3,
          reasons: {
            invalid_type: 1,
            missing_provider: 1,
            non_object: 1,
          },
          keys: ["anthropic:missing-type", "openai:missing-provider", "qwen:not-object"],
        },
      );
    } finally {
      warnSpy.mockRestore();
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
