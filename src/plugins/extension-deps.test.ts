import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const extensionsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../extensions",
);

function getExtensionDirs(): string[] {
  return fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const MAX_DEPTH = 10;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

function dirImportsPackage(dir: string, packageName: string, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dirImportsPackage(fullPath, packageName, depth + 1)) {
        return true;
      }
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const content = fs.readFileSync(fullPath, "utf8");
      const importPattern = new RegExp(
        `(?:from\\s+["']${packageName}["']|require\\(["']${packageName}["']\\)|import\\s+["']${packageName}["'])`,
      );
      if (importPattern.test(content)) {
        return true;
      }
    }
  }
  return false;
}

function extensionImportsPackage(extDir: string, packageName: string): boolean {
  const srcDir = path.join(extensionsDir, extDir, "src");
  if (!fs.existsSync(srcDir)) {
    return false;
  }
  return dirImportsPackage(srcDir, packageName);
}

function readExtensionPackageJson(extDir: string): PackageJson {
  const packagePath = path.join(extensionsDir, extDir, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageJson;
}

describe("extension dependency declarations", () => {
  it("every extension that imports zod must list it in dependencies", () => {
    const missing: string[] = [];

    for (const extDir of getExtensionDirs()) {
      if (!extensionImportsPackage(extDir, "zod")) {
        continue;
      }
      const pkg = readExtensionPackageJson(extDir);
      if (!pkg.dependencies?.["zod"]) {
        missing.push(extDir);
      }
    }

    expect(
      missing,
      `extensions importing zod without listing it in dependencies: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
