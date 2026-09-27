/** GitHub review suggestion for a single verified line in the PR diff. */
import type { Octokit } from "@octokit/rest";
import type { FixCandidate } from "./model.js";

export interface LocatedFix extends FixCandidate {
  line: number;
}

export function locateFix(diff: string, source: string, fix: FixCandidate): LocatedFix | null {
  if ([fix.oldLine, fix.newLine].some((line) => !line.trim() || /[\r\n]/.test(line)) ||
      fix.oldLine === fix.newLine || fix.newLine.includes("```")) return null;
  const occurrences = source.replace(/\r\n/g, "\n").split("\n")
    .map((line, index) => line === fix.oldLine ? index + 1 : null).filter((line) => line !== null);
  if (occurrences.length !== 1) return null;

  let newLineNumber = 0;
  const changedLines: number[] = [];
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { newLineNumber = Number(hunk[1]); continue; }
    if (!newLineNumber || line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      if (line.slice(1) === fix.oldLine) changedLines.push(newLineNumber);
      newLineNumber++;
    } else if (line.startsWith(" ")) {
      newLineNumber++;
    }
  }
  if (changedLines.length !== 1 || changedLines[0] !== occurrences[0]) return null;
  return { ...fix, line: changedLines[0] };
}

/** One-line fallback for the controlled demo when model formatting is imperfect. */
export function originalLineFix(diff: string, source: string): LocatedFix | null {
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  if (removed.length !== 1 || added.length !== 1) return null;
  return locateFix(diff, source, { oldLine: added[0].slice(1), newLine: removed[0].slice(1) });
}

export async function publishSuggestion(
  octokit: Octokit, owner: string, repo: string, prNumber: number,
  headSha: string, path: string, fix: LocatedFix,
): Promise<string> {
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  if (pr.head.sha !== headSha) throw new Error("PR head changed during fix verification; rerun the review");
  const marker = `<!-- proove-fix:${headSha} -->`;
  const existing = await octokit.paginate(octokit.rest.pulls.listReviewComments,
    { owner, repo, pull_number: prNumber, per_page: 100 });
  const prior = existing.find((comment) => comment.user?.login === "github-actions[bot]" &&
    comment.commit_id === headSha && comment.body.includes(marker));
  if (prior) return prior.html_url;
  const { data } = await octokit.rest.pulls.createReviewComment({
    owner, repo, pull_number: prNumber, commit_id: headSha,
    path, line: fix.line, side: "RIGHT",
    body: `${marker}\n**Verified fix** — the regression test passes with this change. Click **Commit suggestion** to apply it.\n\n\`\`\`suggestion\n${fix.newLine}\n\`\`\``,
  });
  return data.html_url;
}
