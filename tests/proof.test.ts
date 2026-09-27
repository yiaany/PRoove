/**
 * tests/proof.test.ts
 *
 * Tests the proof runner using the real local demo repository.
 * Verifies:
 *   - base PASS / head FAIL → proven = true (PROVEN BUG)
 *   - base PASS / head PASS → proven = false (NOT PROVEN)
 *   - unknown repo → supported = false
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createDemoRepo } from "../scripts/create-demo-repo.js";
import { runProof, DEMO_REPO_SOURCE } from "../bot/proof.js";
import { execSync } from "node:child_process";
import { join } from "node:path";

let demoRepoPath: string;
let baseSha: string;
let headSha: string;

// Create the demo repo once before all proof tests
beforeAll(async () => {
  demoRepoPath = await createDemoRepo();

  // Read SHAs: git log newest-first → [0]=head, [1]=base
  const log = execSync("git log --oneline -2", {
    cwd: demoRepoPath,
    encoding: "utf8",
  });
  const lines = log.trim().split("\n");
  headSha = lines[0].split(" ")[0];
  baseSha = lines[1].split(" ")[0];
}, 120_000); // allow time for npm install

const PROVEN_TEST = `
import { describe, it, expect } from "vitest";
import { applyDiscount } from "../src/checkout.js";

describe("regression candidate", () => {
  it("price should never go negative even with >100% discount", () => {
    const result = applyDiscount(10.00, 150);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
`;

const ALWAYS_PASSING_TEST = `
import { describe, it, expect } from "vitest";
import { applyDiscount } from "../src/checkout.js";

describe("always passing", () => {
  it("20% discount on 100 = 80", () => {
    expect(applyDiscount(100, 20)).toBe(80);
  });
});
`;

describe("runProof — PROVEN BUG scenario", () => {
  it(
    "base PASS + head FAIL → proven = true",
    async () => {
      const result = await runProof(demoRepoPath, baseSha, headSha, PROVEN_TEST);
      expect(result.supported).toBe(true);
      expect(result.baseRun?.status).toBe("PASS");
      expect(result.headRun?.status).toBe("FAIL");
      expect(result.proven).toBe(true);
    },
    60_000,
  );
});

describe("runProof — NOT PROVEN scenario", () => {
  it(
    "base PASS + head PASS → proven = false",
    async () => {
      const result = await runProof(demoRepoPath, baseSha, headSha, ALWAYS_PASSING_TEST);
      expect(result.supported).toBe(true);
      expect(result.baseRun?.status).toBe("PASS");
      expect(result.headRun?.status).toBe("PASS");
      expect(result.proven).toBe(false);
    },
    60_000,
  );
});

describe("runProof — unsupported repository", () => {
  it("returns supported=false for a path without SPEC.md", async () => {
    const result = await runProof("/tmp", baseSha, headSha, PROVEN_TEST);
    expect(result.supported).toBe(false);
    expect(result.proven).toBe(false);
  });
});

describe("runProof — invalid test source", () => {
  it("reports ERROR rather than treating a compile failure as a regression", async () => {
    const result = await runProof(demoRepoPath, baseSha, headSha, "this is not typescript!!!");
    expect(result.baseRun?.status).toBe("ERROR");
    expect(result.headRun?.status).toBe("ERROR");
    expect(result.proven).toBe(false);
  }, 120_000);
});
