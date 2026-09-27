/**
 * cli.ts — Entry point for PRoove bot.
 *
 * Usage:
 *   node dist/bot/cli.js                  (reads from GITHUB event env vars, posts to GitHub)
 *   node dist/bot/cli.js --demo           (npm run bot:demo — mock model, no network)
 */

import { runReview } from "./review.js";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const isDemo = process.argv.includes("--demo");

async function main(): Promise<void> {
  if (isDemo) {
    await runDemoMode();
  } else {
    await runLiveMode();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DEMO MODE — no network, mock model, real proof runner on local fixture
// ──────────────────────────────────────────────────────────────────────────────
async function runDemoMode(): Promise<void> {
  console.log("=== PRoove bot:demo ===");
  console.log("Running with MOCK model response and local demo repository.\n");

  // Create (or locate) the demo git repository
  const demoRepoPath = await ensureDemoRepo();
  const { baseSha, headSha } = readDemoSHAs(demoRepoPath);

  console.log(`Demo repo : ${demoRepoPath}`);
  console.log(`Base SHA  : ${baseSha}`);
  console.log(`Head SHA  : ${headSha}\n`);

  // Mock model response — a hardcoded realistic candidate for the discount demo
  const mockCandidate = {
    suspectedBug:
      "applyDiscount() allows the final price to go negative when discount exceeds 100%",
    specRule:
      "The discounted price MUST NOT be negative; a discount greater than the item price should result in a price of 0.00.",
    testCode: buildMockTestCode(),
  };

  console.log("[ MOCK DEMO ] Model candidate:");
  console.log(`  Bug  : ${mockCandidate.suspectedBug}`);
  console.log(`  SPEC : ${mockCandidate.specRule}\n`);

  const result = await runReview({
    owner: "demo",
    repo: "demo",
    prNumber: 0,
    baseSha,
    headSha,
    mockModelResponse: mockCandidate,
    repoPath: demoRepoPath,
    fixtureDir: ".",
    dryRun: true,
  });

  console.log("─────────────────────────────────────────────────────");
  console.log("PR Comment (Markdown):");
  console.log("─────────────────────────────────────────────────────");
  console.log(result.commentBody);
  console.log("─────────────────────────────────────────────────────");
  console.log(`\nVerdict: ${result.proven ? "PROVEN BUG ✅" : "NOT PROVEN ℹ️"}`);

  if (!result.proven) {
    process.exit(1);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// LIVE MODE — reads GitHub event JSON, fetches real diff, calls model, posts comment
// ──────────────────────────────────────────────────────────────────────────────
async function runLiveMode(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!eventPath || !githubToken) {
    console.error(
      "ERROR: GITHUB_EVENT_PATH and GITHUB_TOKEN must be set (run inside GitHub Actions)",
    );
    process.exit(1);
  }

  // Parse the pull_request event payload
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.error(`ERROR: Could not read event file: ${err}`);
    process.exit(1);
  }

  const pr = event["pull_request"] as Record<string, unknown> | undefined;
  if (!pr) {
    console.error("ERROR: Event does not contain pull_request payload");
    process.exit(1);
  }

  const repository = event["repository"] as Record<string, unknown> | undefined;
  const owner = (repository?.["owner"] as Record<string, unknown>)?.["login"] as string;
  const repo = (repository?.["name"]) as string;
  const prNumber = pr["number"] as number;
  const headSha = (pr["head"] as Record<string, unknown>)?.["sha"] as string;
  const baseSha = (pr["base"] as Record<string, unknown>)?.["sha"] as string;

  if (!owner || !repo || !prNumber || !headSha || !baseSha) {
    console.error("ERROR: Missing required fields in event payload");
    console.error(JSON.stringify({ owner, repo, prNumber, headSha, baseSha }, null, 2));
    process.exit(1);
  }

  console.log(`PRoove reviewing PR #${prNumber} in ${owner}/${repo}`);
  console.log(`Base: ${baseSha} → Head: ${headSha}`);

  const result = await runReview({
    owner,
    repo,
    prNumber,
    baseSha,
    headSha,
    repoPath: process.cwd(),
    fixtureDir: "fixtures/demo-repo",
    githubToken,
    dryRun: false,
  });

  console.log(`\nComment posted: ${result.commentUrl ?? "(dry-run)"}`);
  console.log(`Verdict: ${result.proven ? "PROVEN BUG" : "NOT PROVEN"}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Create demo repository and return its path */
async function ensureDemoRepo(): Promise<string> {
  // Try compiled JS first (after build), fall back to ts source with strip-types
  const jsScript = resolve(PROJECT_ROOT, "dist/scripts/create-demo-repo.js");
  const tsScript = resolve(PROJECT_ROOT, "scripts/create-demo-repo.ts");
  const scriptPath = existsSync(jsScript) ? jsScript : tsScript;
  // pathToFileURL is required on Windows (C:\... is not a valid ESM specifier)
  const { createDemoRepo } = await import(pathToFileURL(scriptPath).href);
  return createDemoRepo() as Promise<string>;
}

/** Read base and head SHAs from the demo repo log */
function readDemoSHAs(demoRepoPath: string): { baseSha: string; headSha: string } {
  const log = execSync("git log --oneline -2", {
    cwd: demoRepoPath,
    encoding: "utf8",
  });
  const lines = log.trim().split("\n");
  if (lines.length < 2) {
    throw new Error(`Demo repo does not have two commits: ${log}`);
  }
  // git log is newest-first: lines[0] = head, lines[1] = base
  const headSha = lines[0].split(" ")[0];
  const baseSha = lines[1].split(" ")[0];
  return { baseSha, headSha };
}

/** Build the mock test code for demo mode */
function buildMockTestCode(): string {
  return `import { describe, it, expect } from "vitest";
import { applyDiscount } from "../src/checkout.js";

describe("applyDiscount — regression candidate", () => {
  it("price should never go negative even with >100% discount", () => {
    // A 150% discount on a $10 item should yield $0.00, not -$5.00
    const result = applyDiscount(10.00, 150);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
`;
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
