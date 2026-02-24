import * as nip19 from "nostr-tools/nip19";
import { describe, expect, test } from "vitest";
import { normalizePubkey } from "./nostr-bus.js";

describe("normalizePubkey", () => {
  test("converts hex pubkey to lowercase", () => {
    const hex = "ABCD".repeat(16); // 64 hex chars
    expect(normalizePubkey(hex)).toBe(hex.toLowerCase());
  });

  test("preserves lowercase hex pubkey", () => {
    const hex = "abcd".repeat(16); // 64 hex chars
    expect(normalizePubkey(hex)).toBe(hex);
  });

  test("trims whitespace from hex input", () => {
    const hex = "abcd".repeat(16);
    expect(normalizePubkey(`  ${hex}  `)).toBe(hex);
  });

  test("throws on invalid hex length", () => {
    expect(() => normalizePubkey("abcd")).toThrow("Pubkey must be 64 hex characters");
  });

  test("throws on invalid hex characters", () => {
    expect(() => normalizePubkey("z".repeat(64))).toThrow("Pubkey must be 64 hex characters");
  });

  test("decodes npub key with current nostr-tools (returns string in 2.23+)", () => {
    // Generate a real npub using current nostr-tools
    const testHex = "1234567890abcdef".repeat(4);
    const npub = nip19.npubEncode(testHex);

    const result = normalizePubkey(npub);
    expect(result).toBe(testHex);
    expect(result).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(result)).toBe(true);
  });

  test("handles multiple npub keys correctly", () => {
    const testCases = [
      "0000000000000000000000000000000000000000000000000000000000000001",
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    ];

    for (const hex of testCases) {
      const npub = nip19.npubEncode(hex);
      const result = normalizePubkey(npub);
      expect(result).toBe(hex);
    }
  });

  test("round-trip conversion: hex -> npub -> hex", () => {
    const originalHex = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const npub = nip19.npubEncode(originalHex);
    const normalizedHex = normalizePubkey(npub);
    expect(normalizedHex).toBe(originalHex);
  });
});
