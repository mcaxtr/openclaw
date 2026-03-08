import { describe, expect, it } from "vitest";
import { deriveOpenAICodexCanonicalProfileId } from "./auth-profiles/openai-codex-profile-id.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${header}.${body}.sig`;
}

describe("deriveOpenAICodexCanonicalProfileId", () => {
  it("derives a stable Codex profile id from accountId, iss, and sub", () => {
    const profileId = deriveOpenAICodexCanonicalProfileId({
      provider: "openai-codex",
      access: makeJwt({
        iss: "https://auth.openai.com",
        sub: "user_123",
        "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" },
      }),
      accountId: "acct_123",
    });

    expect(profileId).toBe(
      `openai-codex:acct_123:${Buffer.from("https://auth.openai.com", "utf8").toString("base64url")}:${Buffer.from("user_123", "utf8").toString("base64url")}`,
    );
  });

  it("falls back to the accountId embedded in the token payload", () => {
    const profileId = deriveOpenAICodexCanonicalProfileId({
      provider: "openai-codex",
      access: makeJwt({
        iss: "https://auth.openai.com",
        sub: "user_456",
        "https://api.openai.com/auth": { chatgpt_account_id: "acct_payload" },
      }),
    });

    expect(profileId).toBe(
      `openai-codex:acct_payload:${Buffer.from("https://auth.openai.com", "utf8").toString("base64url")}:${Buffer.from("user_456", "utf8").toString("base64url")}`,
    );
  });

  it("returns null for non-codex providers or malformed tokens", () => {
    expect(
      deriveOpenAICodexCanonicalProfileId({
        provider: "openai",
        access: makeJwt({
          iss: "https://auth.openai.com",
          sub: "user_789",
          "https://api.openai.com/auth": { chatgpt_account_id: "acct_bad" },
        }),
      }),
    ).toBeNull();
    expect(
      deriveOpenAICodexCanonicalProfileId({
        provider: "openai-codex",
        access: "not-a-jwt",
      }),
    ).toBeNull();
  });
});
