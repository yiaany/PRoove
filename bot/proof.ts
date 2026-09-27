/**
 * proof.ts — Test execution engine.
 *
 * Runs a candidate Vitest regression test against TWO git revisions
 * using separate temporary worktrees. Works ONLY for the known demo
 * repository (fixtures/demo-repo). For unknown repositories it returns
 * UNSUPPORTED rather than running arbitrary install/test commands.
 *
 * Child processes receive a minimal environment WITHOUT OPENAI_COMPAT_API_KEY
 * or GITHUB_TOKEN to prevent secret leakage.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Absolute path to fixtures/demo-repo relative to project root */
export const DEMO_REPO_SOURCE = resolve(__dirname, "../fixtures/demo-repo");

export type RunStatus = "PASS" | "FAIL" | "ERROR";
export type FixtureDir = "." | "fixtures/demo-repo";

export interface ProofRun {
  status: RunStatus;
  log: string;
}

export interface ProofResult {
  supported: boolean;
  baseRun?: ProofRun;
  headRun?: ProofRun;
  proven: boolean; // true only when base=PASS and head=FAIL
  durationMs?: number; // measured wall-clock time including worktree setup
}

export interface FixProof {
  status: RunStatus;
  log: string;
}

/**
 * Safe minimal environment for child test processes.
 * Strips secrets and CI tokens so they are never accessible to demo code.
 */
function safeEnv(): NodeJS.ProcessEnv {
  const ALLOWED = new Set(["PATH", "Path", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot",
    "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "CI", "NO_COLOR", "HTTPS_PROXY",
    "HTTP_PROXY", "NO_PROXY", "NPM_CONFIG_CACHE"]);
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ALLOWED.has(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Run vitest on a given worktree directory with a specific test file injected.
 */
function runTest(worktreeDir: string, testFile: string, testCode: string): ProofRun {
  // Write the test file into the worktree
  const testPath = join(worktreeDir, testFile);
  mkdirSync(join(worktreeDir, "tests"), { recursive: true });
  writeFileSync(testPath, testCode, "utf8");

  const reportPath = join(worktreeDir, "proove-result.json");
  const vitestPath = join(worktreeDir, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(vitestPath)) return { status: "ERROR", log: "Vitest is not installed" };
  const result = spawnSync(
    process.execPath,
    [vitestPath, "run", "--reporter=json", "--no-color", `--outputFile=${reportPath}`, testFile],
    {
      cwd: worktreeDir,
      env: safeEnv(),
      timeout: 30_000,
      encoding: "utf8",
    },
  );
  if (result.error || result.signal || !existsSync(reportPath)) {
    return { status: "ERROR", log: String(result.error ?? result.stderr ?? result.signal).slice(0, 3000) };
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      numPassedTests: number; numFailedTests: number;
      testResults: Array<{ assertionResults: Array<{ status: string; failureMessages: string[] }> }>;
    };
    const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
    const failures = assertions.filter((assertion) => assertion.status === "failed");
    const log = failures.flatMap((assertion) => assertion.failureMessages).join("\n") ||
      `Vitest: ${report.numPassedTests} passed, ${report.numFailedTests} failed`;
    // A runner crash, a collection error, and a test with zero assertions
    // are not evidence of a regression.
    const executed = report.numPassedTests + report.numFailedTests;
    const status: RunStatus = result.status === 0 && executed > 0 ? "PASS" :
      result.status === 1 && failures.length > 0 && report.numFailedTests === failures.length ? "FAIL" : "ERROR";
    return { status, log: (status === "ERROR" ? `${log}\n${result.stderr ?? ""}` : log).slice(0, 3000) };
  } catch (err) {
    return { status: "ERROR", log: `Could not read Vitest results: ${String(err)}` };
  }
}

/**
 * Prepare a temporary worktree for a given SHA of the demo git repository.
 * repoPath must be a git repository root.
 */
function checkoutWorktree(repoPath: string, sha: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), `proove-wt-`));
  try {
    const result = spawnSync("git", ["worktree", "add", "--detach", tmpDir, sha],
      { cwd: repoPath, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "git worktree add failed");
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
  return tmpDir;
}

/**
 * Remove a worktree and clean up git state.
 */
function removeWorktree(repoPath: string, worktreeDir: string): void {
  try {
    const result = spawnSync("git", ["worktree", "remove", "--force", worktreeDir],
      { cwd: repoPath, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  } catch {
    // If the git command fails, remove the directory manually
    try {
      rmSync(worktreeDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/**
 * Execute the proof: run testCode against baseSha and headSha of the demo repo.
 *
 * @param demoRepoPath  Absolute path to the two-commit demo git repository
 *                      (created by scripts/create-demo-repo.ts).
 * @param baseSha       Git SHA of the base (correct) commit.
 * @param headSha       Git SHA of the head (regression) commit.
 * @param testCode      Vitest test source to inject.
 */
export async function runProof(
  demoRepoPath: string,
  baseSha: string,
  headSha: string,
  testCode: string,
  fixtureDir: FixtureDir = ".",
): Promise<ProofResult> {
  const specPath = join(demoRepoPath, fixtureDir, "SPEC.md");
  if (!existsSync(specPath)) {
    return { supported: false, proven: false };
  }

  const started = performance.now();

  let baseWorktree: string | null = null;
  let headWorktree: string | null = null;

  try {
    baseWorktree = checkoutWorktree(demoRepoPath, baseSha);
    headWorktree = checkoutWorktree(demoRepoPath, headSha);

    for (const wt of [baseWorktree, headWorktree]) {
      const fixtureRoot = join(wt, fixtureDir);
      if (!existsSync(join(fixtureRoot, "package.json")) ||
          !existsSync(join(fixtureRoot, "SPEC.md"))) {
        return { supported: false, proven: false };
      }
      if (!existsSync(join(fixtureRoot, "node_modules", "vitest", "vitest.mjs"))) {
        const install = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm",
          ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], {
          cwd: fixtureRoot,
          env: safeEnv(),
          timeout: 60_000,
          encoding: "utf8",
          shell: process.platform === "win32",
        });
        if (install.status !== 0 || install.error) {
          return { supported: true, proven: false,
            baseRun: { status: "ERROR", log: `Dependency install failed: ${String(install.error ?? install.stderr)}`.slice(0, 3000) } };
        }
      }
    }

    const baseRun = runTest(join(baseWorktree, fixtureDir), "tests/regression-candidate.test.ts", testCode);
    const headRun = runTest(join(headWorktree, fixtureDir), "tests/regression-candidate.test.ts", testCode);

    const proven = baseRun.status === "PASS" && headRun.status === "FAIL";
    return { supported: true, baseRun, headRun, proven, durationMs: Math.round(performance.now() - started) };
  } finally {
    if (baseWorktree) removeWorktree(demoRepoPath, baseWorktree);
    if (headWorktree) removeWorktree(demoRepoPath, headWorktree);
  }
}

/** Test a proposed one-line fix against the exact PR head, without touching its branch. */
export async function verifyFix(
  repoPath: string,
  headSha: string,
  testCode: string,
  oldLine: string,
  newLine: string,
  fixtureDir: FixtureDir,
): Promise<FixProof> {
  const worktree = checkoutWorktree(repoPath, headSha);
  try {
    const root = join(worktree, fixtureDir);
    const sourceFile = join(root, "src", "checkout.ts");
    if (!existsSync(sourceFile)) return { status: "ERROR", log: "Source file is missing" };
    const source = readFileSync(sourceFile, "utf8");
    const lines = source.split("\n");
    if (lines.filter((line) => line.replace(/\r$/, "") === oldLine).length !== 1) {
      return { status: "ERROR", log: "Fix target must match exactly one line of PR head" };
    }
    writeFileSync(sourceFile, lines.map((line) =>
      line.replace(/\r$/, "") === oldLine ? newLine + (line.endsWith("\r") ? "\r" : "") : line).join("\n"));
    const install = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], {
        cwd: root, env: safeEnv(), timeout: 60_000, encoding: "utf8",
        shell: process.platform === "win32",
      });
    if (install.status !== 0 || install.error) {
      return { status: "ERROR", log: `Fix dependencies unavailable: ${String(install.error ?? install.stderr)}`.slice(0, 3000) };
    }
    return runTest(root, "tests/regression-candidate.test.ts", testCode);
  } finally {
    removeWorktree(repoPath, worktree);
  }
}

/**
 * Read SPEC.md from the demo repo source fixture.
 */
export function readDemoSpec(): string {
  const specPath = join(DEMO_REPO_SOURCE, "SPEC.md");
  if (!existsSync(specPath)) {
    throw new Error(`SPEC.md not found at ${specPath}`);
  }
  return readFileSync(specPath, "utf8");
}
