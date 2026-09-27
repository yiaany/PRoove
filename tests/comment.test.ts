/**
 * tests/comment.test.ts
 *
 * Tests for Markdown comment building and the upsert logic.
 * Uses a mock Octokit to verify create vs update behaviour.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildCommentBody,
  COMMENT_MARKER,
  readStoredProof,
  findExistingComment,
  upsertComment,
} from "../bot/comment.js";
import type { ProofResult } from "../bot/proof.js";
import type { ModelCandidate } from "../bot/model.js";

// ── buildCommentBody ──────────────────────────────────────────────────────────

describe("buildCommentBody — PROVEN BUG", () => {
  const candidate: ModelCandidate = {
    suspectedBug: "price goes negative with >100% discount",
    specRule: "The discounted price MUST NOT be negative",
    testCode: `it('no negative price', () => { expect(applyDiscount(10, 150)).toBeGreaterThanOrEqual(0); });`,
  };
  const proof: ProofResult = {
    supported: true,
    baseRun: { status: "PASS", log: "✓ 1 test passed" },
    headRun: { status: "FAIL", log: "✗ 1 test failed" },
    proven: true,
  };

  it("contains the PROVEN BUG label", () => {
    const body = buildCommentBody({ headSha: "abc1234", candidate, proof });
    expect(body).toContain("PROVEN BUG");
  });

  it("contains the head SHA", () => {
    const body = buildCommentBody({ headSha: "abc1234567890", candidate, proof });
    expect(body).toContain("abc1234");
  });

  it("contains the comment marker", () => {
    const body = buildCommentBody({ headSha: "abc1234", candidate, proof });
    expect(body).toContain(COMMENT_MARKER);
  });

  it("contains the suspected bug description", () => {
    const body = buildCommentBody({ headSha: "abc1234", candidate, proof });
    expect(body).toContain("price goes negative with >100% discount");
  });

  it("contains PASS for base and FAIL for head", () => {
    const body = buildCommentBody({ headSha: "abc1234", candidate, proof });
    expect(body).toContain("PASS");
    expect(body).toContain("FAIL");
  });

  it("contains the test code", () => {
    const body = buildCommentBody({ headSha: "abc1234", candidate, proof });
    expect(body).toContain("no negative price");
  });

  it("does not claim an unverified fix is available", () => {
    const body = buildCommentBody({ headSha: "abc1234", candidate, proof });
    expect(body).toContain("No verified fix available for this commit");
  });

  it("renders a compact evidence card with measured runtime and collapsible details", () => {
    const body = buildCommentBody({
      baseSha: "1234567a", headSha: "abcdef1234", candidate,
      proof: { ...proof, durationMs: 2450 },
      fixUrl: "https://github.com/example/repo/pull/1#discussion_r1",
      runUrl: "https://github.com/example/repo/actions/runs/42",
    });
    expect(body).toContain("## PRoove · Proof Card");
    expect(body).toContain("| Same regression test | ✅ PASS | ❌ FAIL |");
    expect(body).toContain("2.5s total");
    expect(body).toContain("Apply the verified fix");
    expect(body).toContain("actions/runs/42");
    expect(body).toContain("<details><summary>Regression test · source</summary>");
    expect(body).toContain("<details><summary>PR revision · test log</summary>");
    expect(readStoredProof(body)).toEqual({ baseSha: "1234567a", headSha: "abcdef1234", candidate });
  });

  it("uses a longer fence when model output contains triple backticks", () => {
    const body = buildCommentBody({ headSha: "abcdef1",
      candidate: { ...candidate, testCode: "// ```\nit('example', () => {});" }, proof });
    expect(body).toContain("````typescript\n// ```");
  });
});

describe("buildCommentBody — FIX VERIFIED", () => {
  it("keeps the original test and clearly distinguishes a verified fix from a proven bug", () => {
    const candidate: ModelCandidate = { suspectedBug: "negative price", specRule: "price >= 0", testCode: "it('price', () => {});" };
    const body = buildCommentBody({ baseSha: "abcdef1", headSha: "abcdef2", candidate,
      proof: { supported: true, proven: false,
        baseRun: { status: "PASS", log: "1 passed" }, headRun: { status: "PASS", log: "1 passed" } },
      resolved: true });
    expect(body).toContain("FIX VERIFIED");
    expect(body).toContain("| Same regression test | ✅ PASS | ✅ PASS |");
    expect(body).toContain("this specific regression is no longer reproducible");
    expect(body).not.toContain("PROVEN BUG");
    expect(readStoredProof(body)?.candidate).toEqual(candidate);
  });
});

describe("buildCommentBody — NOT PROVEN (both pass)", () => {
  const candidate: ModelCandidate = {
    suspectedBug: "some bug",
    specRule: "some rule",
    testCode: `it('test', () => {});`,
  };
  const proof: ProofResult = {
    supported: true,
    baseRun: { status: "PASS", log: "1 pass" },
    headRun: { status: "PASS", log: "1 pass" },
    proven: false,
  };

  it("labels NOT PROVEN when both revisions pass", () => {
    const body = buildCommentBody({ headSha: "def5678", candidate, proof });
    expect(body).toContain("NOT PROVEN");
    expect(body).not.toContain("PROVEN BUG");
  });

  it("explains both revisions passed", () => {
    const body = buildCommentBody({ headSha: "def5678", candidate, proof });
    expect(body).toContain("Both revisions passed");
  });
});

describe("buildCommentBody — NOT PROVEN (no candidate)", () => {
  it("labels NOT PROVEN and mentions no candidate", () => {
    const body = buildCommentBody({ headSha: "aaa0000", candidate: null, proof: null });
    expect(body).toContain("NOT PROVEN");
    expect(body).toContain("No regression candidate");
  });
});

describe("buildCommentBody — unsupported repo", () => {
  const candidate: ModelCandidate = {
    suspectedBug: "some bug",
    specRule: "some rule",
    testCode: `it('test', () => {});`,
  };
  const proof: ProofResult = { supported: false, proven: false };

  it("reports executable proof unsupported", () => {
    const body = buildCommentBody({ headSha: "bbb1111", candidate, proof });
    expect(body).toContain("NOT PROVEN");
    expect(body).toContain("unsupported");
  });
});

describe("buildCommentBody — error path", () => {
  it("reports error and labels NOT PROVEN", () => {
    const body = buildCommentBody({
      headSha: "ccc2222",
      candidate: null,
      proof: null,
      errorMessage: "API call failed: 401 Unauthorized",
    });
    expect(body).toContain("NOT PROVEN");
    expect(body).toContain("401 Unauthorized");
  });
});

describe("buildCommentBody — demo mode label", () => {
  it("shows MOCK DEMO label in demo mode", () => {
    const body = buildCommentBody({
      headSha: "ddd3333",
      candidate: null,
      proof: null,
      isDemoMode: true,
    });
    expect(body).toContain("MOCK DEMO");
  });
});

// ── findExistingComment / upsertComment ───────────────────────────────────────

describe("findExistingComment", () => {
  it("does not update another user's marked comment", async () => {
    const mockOctokit = {
      rest: { issues: { listComments: vi.fn() } },
      paginate: vi.fn().mockResolvedValue([
        { id: 42, user: { login: "someone-else" }, body: COMMENT_MARKER },
      ]),
    };
    expect(await findExistingComment(mockOctokit as never, "owner", "repo", 1)).toBeNull();
  });

  it("returns comment id when marker is found", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn(),
        },
      },
      paginate: vi.fn().mockResolvedValue([
        { id: 42, user: { login: "github-actions[bot]" }, body: `${COMMENT_MARKER}\n## PRoove Review` },
        { id: 99, body: "unrelated comment" },
      ]),
    };

    const id = await findExistingComment(
      mockOctokit as never,
      "owner",
      "repo",
      1,
    );
    expect(id).toBe(42);
  });

  it("returns null when no marker found", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn(),
        },
      },
      paginate: vi.fn().mockResolvedValue([{ id: 10, body: "no marker here" }]),
    };

    const id = await findExistingComment(
      mockOctokit as never,
      "owner",
      "repo",
      1,
    );
    expect(id).toBeNull();
  });
});

describe("upsertComment", () => {
  it("creates a new comment when none exists", async () => {
    const createComment = vi.fn().mockResolvedValue({ data: { html_url: "https://example.com/1" } });
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn(),
          createComment,
          updateComment: vi.fn(),
        },
      },
      paginate: vi.fn().mockResolvedValue([]),
    };

    const url = await upsertComment(mockOctokit as never, "o", "r", 1, "body");
    expect(createComment).toHaveBeenCalledOnce();
    expect(url).toBe("https://example.com/1");
  });

  it("updates the existing comment when marker found", async () => {
    const updateComment = vi.fn().mockResolvedValue({ data: { html_url: "https://example.com/2" } });
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn(),
          createComment: vi.fn(),
          updateComment,
        },
      },
      paginate: vi.fn().mockResolvedValue([
        { id: 77, user: { login: "github-actions[bot]" }, body: `${COMMENT_MARKER}\nold body` },
      ]),
    };

    const url = await upsertComment(mockOctokit as never, "o", "r", 1, "new body");
    expect(updateComment).toHaveBeenCalledOnce();
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 77, body: "new body" }),
    );
    expect(url).toBe("https://example.com/2");
  });
});
