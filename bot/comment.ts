/**
 * comment.ts — Markdown formatting and GitHub PR comment posting/updating.
 *
 * Posts exactly one comment per PR (identified by <!-- proove-review --> marker).
 * On re-run, finds and updates the existing comment rather than creating a duplicate.
 */

import { Octokit } from "@octokit/rest";
import type { ProofResult } from "./proof.js";
import type { ModelCandidate } from "./model.js";

export const COMMENT_MARKER = "<!-- proove-review -->";

export interface CommentData {
  baseSha?: string;
  headSha: string;
  candidate: ModelCandidate | null;
  proof: ProofResult | null;
  errorMessage?: string;
  isDemoMode?: boolean;
  fixUrl?: string;
  fixStatus?: string;
  resolved?: boolean;
  runUrl?: string;
}

export interface StoredProof {
  baseSha: string;
  headSha: string;
  candidate: ModelCandidate;
}

export function readStoredProof(body: string): StoredProof | null {
  const match = /<!-- proove-proof:([A-Za-z0-9+/=]+) -->/.exec(body);
  if (!match) return null;
  try {
    const data = JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as StoredProof;
    if (!/^[0-9a-f]{7,40}$/.test(data.baseSha) || !/^[0-9a-f]{7,40}$/.test(data.headSha) ||
      typeof data.candidate?.testCode !== "string" || data.candidate.testCode.length > 12000 ||
      typeof data.candidate?.specRule !== "string" || typeof data.candidate?.suspectedBug !== "string") return null;
    return data;
  } catch { return null; }
}

function truncateLog(log: string, maxLines = 30): string {
  const lines = log.split("\n");
  if (lines.length <= maxLines) return log;
  return lines.slice(0, maxLines).join("\n") + `\n… (${lines.length - maxLines} more lines)`;
}

function statusBadge(status: "PASS" | "FAIL" | "ERROR" | undefined): string {
  if (status === "PASS") return "✅ PASS";
  if (status === "FAIL") return "❌ FAIL";
  return "⚠️ ERROR";
}

function inline(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\\/g, "\\\\").replace(/([|`*_<])/g, "\\$1").trim();
}

function fenced(text: string, language = ""): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), ([match]) => match.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function details(title: string, text: string, language = ""): string[] {
  return [`<details><summary>${title}</summary>`, "", fenced(text, language), "", "</details>", ""];
}

function elapsed(milliseconds: number | undefined): string {
  return milliseconds === undefined ? "—" : `${(milliseconds / 1000).toFixed(1)}s`;
}

/**
 * Build the Markdown body for the PR comment.
 */
export function buildCommentBody(data: CommentData): string {
  const { headSha, candidate, proof, errorMessage, isDemoMode, fixUrl, fixStatus, resolved, baseSha, runUrl } = data;
  const demoLabel = isDemoMode ? " · **MOCK DEMO**" : "";
  const lines: string[] = [COMMENT_MARKER];
  // Keep the original regression test available on the next synchronize run.
  if (baseSha && candidate && (proof?.proven || resolved)) {
    lines.push(`<!-- proove-proof:${Buffer.from(JSON.stringify({ baseSha, headSha, candidate })).toString("base64")} -->`);
  }
  const proven = proof?.proven ?? false;
  const verdict = resolved ? "✅ FIX VERIFIED" : proven ? "🐛 PROVEN BUG" : "ℹ️ NOT PROVEN";
  lines.push(`## PRoove · Proof Card${demoLabel}`, "", `### ${verdict}`, "");
  lines.push(resolved ? "> The original regression test now passes on the PR head." :
    proven ? "> The same new test passes before this PR and fails on the changed revision." :
    "> No regression has been demonstrated for this revision.", "");

  lines.push("| Evidence | Base revision | PR revision |", "|:--|:--|:--|",
    `| Commit | ${baseSha ? `\`${baseSha.slice(0, 7)}\`` : "—"} | \`${headSha.slice(0, 7)}\` |`,
    `| Same regression test | ${proof?.baseRun ? statusBadge(proof.baseRun.status) : "—"} | ${proof?.headRun ? statusBadge(proof.headRun.status) : "—"} |`,
    `| Proof runtime | ${proof?.durationMs !== undefined ? elapsed(proof.durationMs) + " total" : "—"} | ${resolved ? "Fix confirmed" : proven ? "Bug reproduced" : "Not proven"} |`, "");
  if (runUrl) lines.push(`**[View the GitHub Actions run](${runUrl})** · Full audit trail for this revision.`, "");

  if (candidate) {
    lines.push(`**Finding:** ${inline(candidate.suspectedBug)}`, "");
    lines.push("**Expected behavior · base `SPEC.md`**", "",
      ...candidate.specRule.trim().split(/\r?\n/).map((line) => `> ${line}`), "");
  }
  if (proof?.headRun?.status === "FAIL" && proof.headRun.log) {
    lines.push(`**Observed on PR head:** ${inline(proof.headRun.log.split(/\r?\n/)[0].slice(0, 220))}`, "");
  }

  if (resolved) {
    lines.push("### Resolution", "", "**Fix verified.** The original test now passes on both revisions; the previous suggestion was applied or the behavior was otherwise corrected.", "");
  } else if (proven && fixUrl) {
    lines.push("### Apply the verified fix", "", `**[Open the GitHub suggestion in Files changed](${fixUrl})** → click **Commit suggestion**.`, "",
      "PRoove ran the regression test again on a temporary copy of the PR head with the proposed line replacement. The suggestion is never applied without your approval.", "");
  } else if (proven) {
    lines.push("### Fix status", "", inline(fixStatus ?? "No verified fix available for this commit."), "");
  } else {
    const explanation = errorMessage ? "Review encountered an error; no proof or fix is claimed." :
      !candidate ? "No regression candidate identified in this diff." :
      proof && !proof.supported ? "Executable proof is unsupported for this repository." :
      proof?.baseRun?.status === "FAIL" && proof.headRun?.status === "FAIL" ? "Both revisions failed — test may be incorrect or candidate is wrong." :
      proof?.baseRun?.status === "PASS" && proof.headRun?.status === "PASS" ? "Both revisions passed — candidate test did not detect a regression." :
      proof?.baseRun && proof.baseRun.status !== "PASS" ? "Base revision did not pass — cannot confirm regression." :
      "Test could not confirm a regression.";
    lines.push(`**Why:** ${explanation}`, "", "*No verified fix available for this commit.*", "");
  }

  lines.push("---", "", "#### Inspect the evidence", "");
  if (candidate) lines.push(...details("Regression test · source", candidate.testCode, "typescript"));
  if (proof?.baseRun?.log) lines.push(...details("Base revision · test log", truncateLog(proof.baseRun.log)));
  if (proof?.headRun?.log) lines.push(...details("PR revision · test log", truncateLog(proof.headRun.log)));
  if (errorMessage) lines.push(...details("Review error", errorMessage.slice(0, 3000)));
  lines.push(`<sub>PRoove · evidence from actual Git commits${isDemoMode ? " · local mock candidate" : ""}. A passing test on both revisions means this specific regression is no longer reproducible; it does not certify the entire PR.</sub>`);
  return lines.join("\n");
}

/**
 * Find an existing PRoove comment on the PR (returns comment ID or null).
 */
export async function findExistingComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number | null> {
  return (await getExistingComment(octokit, owner, repo, prNumber))?.id ?? null;
}

export async function getExistingComment(
  octokit: Octokit, owner: string, repo: string, prNumber: number,
): Promise<{ id: number; body: string } | null> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  for (const comment of comments) {
    if (comment.user?.login === "github-actions[bot]" && comment.body?.includes(COMMENT_MARKER)) {
      return { id: comment.id, body: comment.body ?? "" };
    }
  }
  return null;
}

/**
 * Post or update the PRoove comment on the PR.
 * Returns the URL of the comment.
 */
export async function upsertComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<string> {
  const existingId = await findExistingComment(octokit, owner, repo, prNumber);

  if (existingId !== null) {
    const { data } = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body,
    });
    return data.html_url;
  } else {
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    return data.html_url;
  }
}
