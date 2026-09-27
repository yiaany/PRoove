import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReview } from "../bot/review.js";
import { DEMO_REPO_SOURCE } from "../bot/proof.js";

describe("same-repository PR proof", () => {
  it("reviews the exact base/head commits of a PRoove-shaped repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "proove-pr-test-"));
    try {
      const fixture = join(root, "fixtures", "demo-repo");
      mkdirSync(join(root, "fixtures"));
      cpSync(DEMO_REPO_SOURCE, fixture, { recursive: true });
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      git("init");
      git("config", "user.name", "Demo Test");
      git("config", "user.email", "demo@test.local");
      git("add", "fixtures/demo-repo");
      git("commit", "-m", "base fixture");
      const baseSha = git("rev-parse", "HEAD");
      const source = join(fixture, "src", "checkout.ts");
      writeFileSync(source, readFileSync(source, "utf8").replace("Math.max(0, discounted)", "discounted"));
      git("add", "fixtures/demo-repo/src/checkout.ts");
      git("commit", "-m", "introduce negative price regression");
      const headSha = git("rev-parse", "HEAD");
      const result = await runReview({
        owner: "demo", repo: "PRoove", prNumber: 1, repoPath: root,
        fixtureDir: "fixtures/demo-repo", baseSha, headSha, dryRun: true,
        mockModelResponse: {
          suspectedBug: "Negative price after discount above 100%",
          specRule: "The discounted price MUST NOT be negative; a discount greater than the item price should result in a price of 0.00.",
          testCode: `import { it, expect } from "vitest";
import { applyDiscount } from "../src/checkout.js";
it("does not return negative price", () => expect(applyDiscount(10, 150)).toBe(0));`,
        },
      });
      expect(result.proven).toBe(true);
      expect(result.commentBody).toContain(headSha);
      expect(result.commentBody).toContain("PROVEN BUG");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
