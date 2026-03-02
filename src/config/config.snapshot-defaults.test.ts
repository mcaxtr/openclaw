import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAllConfigDefaults } from "./defaults.js";
import { withTempHome } from "./home-env.test-harness.js";
import { createConfigIO } from "./io.js";
import { validateConfigObject } from "./validation.js";

const silentLogger = { warn: () => {}, error: () => {} };

describe("config snapshot defaults pipeline", () => {
  it("applies compaction defaults through the snapshot path (valid config)", async () => {
    await withTempHome("openclaw-snapshot-defaults-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ gateway: { mode: "local" } }, null, 2),
        "utf-8",
      );

      const io = createConfigIO({
        env: {},
        homedir: () => home,
        logger: silentLogger,
      });
      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);
      expect(snapshot.config.agents?.defaults?.compaction?.mode).toBe("safeguard");
    });
  });

  it("applies compaction defaults through the no-file snapshot path", async () => {
    await withTempHome("openclaw-snapshot-nofile-defaults-", async (home) => {
      const io = createConfigIO({
        env: {},
        homedir: () => home,
        logger: silentLogger,
      });
      const snapshot = await io.readConfigFileSnapshot();
      expect(snapshot.valid).toBe(true);
      expect(snapshot.config.agents?.defaults?.compaction?.mode).toBe("safeguard");
    });
  });

  it("applyAllConfigDefaults applies all stages in one call", () => {
    const result = applyAllConfigDefaults({});
    expect(result.messages?.ackReactionScope).toBe("group-mentions");
    expect(result.agents?.defaults?.compaction?.mode).toBe("safeguard");
  });

  it("validateConfigObject applies the full defaults pipeline", () => {
    const result = validateConfigObject({ gateway: { mode: "local" } });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Verify stages that were NOT previously applied by validateConfigObject
    expect(result.config.messages?.ackReactionScope).toBe("group-mentions");
    expect(result.config.agents?.defaults?.compaction?.mode).toBe("safeguard");
  });
});
