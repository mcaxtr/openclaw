export function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${header}.${body}.sig`;
}

export function expectedOpenAICodexProfileId(params: {
  accountId: string;
  iss: string;
  sub: string;
}): string {
  return `openai-codex:${params.accountId}:${Buffer.from(params.iss, "utf8").toString("base64url")}:${Buffer.from(params.sub, "utf8").toString("base64url")}`;
}
