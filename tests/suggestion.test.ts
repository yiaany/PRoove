import { describe, it, expect, vi } from "vitest";
import { locateFix, publishSuggestion } from "../bot/suggestion.js";

const diff = `diff --git a/fixtures/demo-repo/src/checkout.ts b/fixtures/demo-repo/src/checkout.ts
--- a/fixtures/demo-repo/src/checkout.ts
+++ b/fixtures/demo-repo/src/checkout.ts
@@ -3,3 +3,3 @@
 function applyDiscount() {
-  return Math.max(0, discounted);
+  return discounted;
 }
`;
const source = `first\nsecond\nfunction applyDiscount() {\n  return discounted;\n}\n`;
const fix = { oldLine: "  return discounted;", newLine: "  return Math.max(0, discounted);" };

describe("review suggestion", () => {
  it("locates exactly one changed line in head", () => {
    expect(locateFix(diff, source, fix)).toEqual({ ...fix, line: 4 });
  });
  it("rejects unchanged, ambiguous and multiline replacements", () => {
    expect(locateFix(diff, source, { ...fix, oldLine: "first" })).toBeNull();
    expect(locateFix(diff, source + fix.oldLine + "\n", fix)).toBeNull();
    expect(locateFix(diff, source, { ...fix, newLine: "code\nmore code" })).toBeNull();
  });
  it("publishes a suggestion only once for the verified head", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/demo/PRoove/pull/1#discussion_r1" } });
    const octokit = {
      rest: { pulls: {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "abc1234" } } }),
        listReviewComments: vi.fn(), createReviewComment,
      } },
      paginate: vi.fn().mockResolvedValue([]),
    };
    const located = locateFix(diff, source, fix)!;
    await publishSuggestion(octokit as never, "demo", "PRoove", 1, "abc1234", "fixtures/demo-repo/src/checkout.ts", located);
    expect(createReviewComment).toHaveBeenCalledWith(expect.objectContaining({
      line: 4, side: "RIGHT", commit_id: "abc1234",
      body: expect.stringContaining("```suggestion\n  return Math.max(0, discounted);\n```"),
    }));
    octokit.paginate.mockResolvedValue([{ user: { login: "github-actions[bot]" },
      commit_id: "abc1234", body: "<!-- proove-fix:abc1234 -->", html_url: "https://github.com/existing" }]);
    expect(await publishSuggestion(octokit as never, "demo", "PRoove", 1, "abc1234", "fixtures/demo-repo/src/checkout.ts", located))
      .toBe("https://github.com/existing");
    expect(createReviewComment).toHaveBeenCalledOnce();
    octokit.rest.pulls.get.mockResolvedValue({ data: { head: { sha: "changed" } } });
    await expect(publishSuggestion(octokit as never, "demo", "PRoove", 1, "abc1234", "fixtures/demo-repo/src/checkout.ts", located))
      .rejects.toThrow("PR head changed");
  });
});
