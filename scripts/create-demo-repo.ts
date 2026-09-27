/**
 * scripts/create-demo-repo.ts
 *
 * Creates a temporary git repository with two commits:
 *   1. base  — correct applyDiscount with Math.max(0, ...) clamp
 *   2. head  — regressed applyDiscount without the clamp (price can go negative)
 *
 * The existing tests pass on both revisions.
 * PRoove's proposed regression test passes on base and fails on head.
 *
 * Usage (called by bot:demo):
 *   node --input-type=module --eval "import('./scripts/create-demo-repo.ts').then(m => m.createDemoRepo()).then(console.log)"
 *
 * The function prints (and returns) the absolute path to the created repo.
 * Re-uses an existing temp repo if it is still valid.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_SOURCE = existsSync(resolve(__dirname, "../fixtures/demo-repo/package.json"))
  ? resolve(__dirname, "../fixtures/demo-repo")
  : resolve(__dirname, "../../fixtures/demo-repo");

// Cache file so repeated runs reuse the same temp repo
const CACHE_FILE = join(tmpdir(), "proove-demo-repo-path.txt");

export async function createDemoRepo(): Promise<string> {
  // Check if a valid repo already exists
  if (existsSync(CACHE_FILE)) {
    const cached = readFileSync(CACHE_FILE, "utf8").trim();
    if (existsSync(join(cached, ".git")) &&
      !execSync("git ls-files node_modules", { cwd: cached, encoding: "utf8" }).trim()) {
      return cached;
    }
  }

  const repoDir = mkdtempSync(join(tmpdir(), "proove-demo-"));

  // Configure git for this repo only
  const git = (cmd: string) =>
    execSync(`git ${cmd}`, {
      cwd: repoDir,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "PRoove Demo",
        GIT_AUTHOR_EMAIL: "demo@proove.local",
        GIT_COMMITTER_NAME: "PRoove Demo",
        GIT_COMMITTER_EMAIL: "demo@proove.local",
      },
    });

  // Initialize
  git("init");
  git("config user.email demo@proove.local");
  git("config user.name \"PRoove Demo\"");

  // Copy fixture files (excluding checkout.buggy.ts and demo.diff)
  const filesToCopy: Array<[string, string]> = [
    ["package.json", "package.json"],
    ["tsconfig.json", "tsconfig.json"],
    ["vitest.config.ts", "vitest.config.ts"],
    ["SPEC.md", "SPEC.md"],
    ["src/checkout.ts", "src/checkout.ts"],
    ["tests/checkout.test.ts", "tests/checkout.test.ts"],
  ];

  for (const [src, dest] of filesToCopy) {
    const srcPath = join(FIXTURE_SOURCE, src);
    const destPath = join(repoDir, dest);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, readFileSync(srcPath, "utf8"), "utf8");
  }
  writeFileSync(join(repoDir, ".gitignore"), "node_modules/\n", "utf8");

  // Install deps in the temp repo (offline as much as possible)
  execSync("npm install --prefer-offline --no-audit", {
    cwd: repoDir,
    stdio: "pipe",
    encoding: "utf8",
  });

  // Commit 1: base — correct implementation
  git("add -A");
  git("commit -m \"base: correct applyDiscount with non-negative clamp\"");

  // Commit 2: head — introduce the subtle bug (remove the Math.max clamp)
  const buggySource = readFileSync(join(FIXTURE_SOURCE, "src/checkout.buggy.ts"), "utf8")
    // rename export to match original filename expectations
    .replace(/^\/\*\*[\s\S]*?\*\//m, "// HEAD revision — regression introduced")
    .trim();

  writeFileSync(join(repoDir, "src/checkout.ts"), buggySource + "\n", "utf8");
  git("add -A");
  git("commit -m \"refactor: simplify applyDiscount (removes negative-price guard)\"");

  // Cache the path
  writeFileSync(CACHE_FILE, repoDir, "utf8");

  return repoDir;
}
