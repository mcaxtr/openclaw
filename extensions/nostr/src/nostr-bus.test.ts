import * as nip19 from "nostr-tools/nip19";
import { describe, expect, it } from "vitest";
import {
  validatePrivateKey,
  getPublicKeyFromPrivate,
  isValidPubkey,
  normalizePubkey,
  pubkeyToNpub,
} from "./nostr-bus.js";

// Test private key (DO NOT use in production - this is a known test key)
const TEST_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("validatePrivateKey", () => {
  describe("hex format", () => {
    it("accepts valid 64-char hex key", () => {
      const result = validatePrivateKey(TEST_HEX_KEY);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(32);
    });

    it("accepts lowercase hex", () => {
      const result = validatePrivateKey(TEST_HEX_KEY.toLowerCase());
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("accepts uppercase hex", () => {
      const result = validatePrivateKey(TEST_HEX_KEY.toUpperCase());
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("accepts mixed case hex", () => {
      const mixed = "0123456789ABCdef0123456789abcDEF0123456789abcdef0123456789ABCDEF";
      const result = validatePrivateKey(mixed);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("trims whitespace", () => {
      const result = validatePrivateKey(`  ${TEST_HEX_KEY}  `);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("trims newlines", () => {
      const result = validatePrivateKey(`${TEST_HEX_KEY}\n`);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("rejects 63-char hex (too short)", () => {
      expect(() => validatePrivateKey(TEST_HEX_KEY.slice(0, 63))).toThrow(
        "Private key must be 64 hex characters",
      );
    });

    it("rejects 65-char hex (too long)", () => {
      expect(() => validatePrivateKey(TEST_HEX_KEY + "0")).toThrow(
        "Private key must be 64 hex characters",
      );
    });

    it("rejects non-hex characters", () => {
      const invalid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"; // 'g' at end
      expect(() => validatePrivateKey(invalid)).toThrow("Private key must be 64 hex characters");
    });

    it("rejects empty string", () => {
      expect(() => validatePrivateKey("")).toThrow("Private key must be 64 hex characters");
    });

    it("rejects whitespace-only string", () => {
      expect(() => validatePrivateKey("   ")).toThrow("Private key must be 64 hex characters");
    });

    it("rejects key with 0x prefix", () => {
      expect(() => validatePrivateKey("0x" + TEST_HEX_KEY)).toThrow(
        "Private key must be 64 hex characters",
      );
    });
  });

  describe("nsec format", () => {
    it("rejects invalid nsec (wrong checksum)", () => {
      const badNsec = "nsec1invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid";
      expect(() => validatePrivateKey(badNsec)).toThrow();
    });

    it("rejects npub (wrong type)", () => {
      const npub = nip19.npubEncode(TEST_HEX_KEY);
      expect(() => validatePrivateKey(npub)).toThrow();
    });
  });
});

describe("isValidPubkey", () => {
  describe("hex format", () => {
    it("accepts valid 64-char hex pubkey", () => {
      const validHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(isValidPubkey(validHex)).toBe(true);
    });

    it("accepts uppercase hex", () => {
      const validHex = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
      expect(isValidPubkey(validHex)).toBe(true);
    });

    it("rejects 63-char hex", () => {
      const shortHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde";
      expect(isValidPubkey(shortHex)).toBe(false);
    });

    it("rejects 65-char hex", () => {
      const longHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      expect(isValidPubkey(longHex)).toBe(false);
    });

    it("rejects non-hex characters", () => {
      const invalid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg";
      expect(isValidPubkey(invalid)).toBe(false);
    });
  });

  describe("npub format", () => {
    it("rejects invalid npub", () => {
      expect(isValidPubkey("npub1invalid")).toBe(false);
    });

    it("rejects nsec (wrong type)", () => {
      // Use pre-encoded nsec (nsecEncode expects Uint8Array in nostr-tools 2.23+)
      const nsec = nip19.nsecEncode(validatePrivateKey(TEST_HEX_KEY));
      expect(isValidPubkey(nsec)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("rejects empty string", () => {
      expect(isValidPubkey("")).toBe(false);
    });

    it("handles whitespace-padded input", () => {
      const validHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(isValidPubkey(`  ${validHex}  `)).toBe(true);
    });
  });
});

describe("normalizePubkey", () => {
  describe("hex format", () => {
    it("lowercases hex pubkey", () => {
      const upper = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
      const result = normalizePubkey(upper);
      expect(result).toBe(upper.toLowerCase());
    });

    it("trims whitespace", () => {
      const hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(normalizePubkey(`  ${hex}  `)).toBe(hex);
    });

    it("rejects invalid hex", () => {
      expect(() => normalizePubkey("invalid")).toThrow("Pubkey must be 64 hex characters");
    });
  });

  describe("npub format", () => {
    it("decodes npub to hex (handles string return in nostr-tools 2.23+)", () => {
      const testHex = "1234567890abcdef".repeat(4);
      const npub = nip19.npubEncode(testHex);

      const result = normalizePubkey(npub);
      expect(result).toBe(testHex);
      expect(result).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(result)).toBe(true);
    });

    it("round-trip conversion: hex -> npub -> hex", () => {
      const originalHex = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      const npub = nip19.npubEncode(originalHex);
      const normalizedHex = normalizePubkey(npub);
      expect(normalizedHex).toBe(originalHex);
    });

    it("handles multiple npub keys correctly", () => {
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
  });
});

describe("getPublicKeyFromPrivate", () => {
  it("derives public key from hex private key", () => {
    const pubkey = getPublicKeyFromPrivate(TEST_HEX_KEY);
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(pubkey.length).toBe(64);
  });

  it("derives consistent public key", () => {
    const pubkey1 = getPublicKeyFromPrivate(TEST_HEX_KEY);
    const pubkey2 = getPublicKeyFromPrivate(TEST_HEX_KEY);
    expect(pubkey1).toBe(pubkey2);
  });

  it("throws for invalid private key", () => {
    expect(() => getPublicKeyFromPrivate("invalid")).toThrow();
  });
});

describe("pubkeyToNpub", () => {
  it("converts hex pubkey to npub format", () => {
    const hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const npub = pubkeyToNpub(hex);
    expect(npub).toMatch(/^npub1[a-z0-9]+$/);
  });

  it("produces consistent output", () => {
    const hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const npub1 = pubkeyToNpub(hex);
    const npub2 = pubkeyToNpub(hex);
    expect(npub1).toBe(npub2);
  });

  it("normalizes uppercase hex first", () => {
    const lower = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const upper = lower.toUpperCase();
    expect(pubkeyToNpub(lower)).toBe(pubkeyToNpub(upper));
  });
});
