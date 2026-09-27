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

/**
 * Build the Markdown body for the PR comment.
 */
export function buildCommentBody(data: CommentData): string {
  const { headSha, candidate, proof, errorMessage, isDemoMode, fixUrl, fixStatus, resolved, baseSha } = data;
  const shortSha = headSha.slice(0, 7);
  const demoLabel = isDemoMode ? " · **MOCK DEMO**" : "";

  const lines: string[] = [COMMENT_MARKER];
  if (baseSha && candidate && proof?.proven) {
    lines.push(`<!-- proove-proof:${Buffer.from(JSON.stringify({ baseSha, headSha, candidate })).toString("base64")} -->`);
  }
  // Keep the original regression test available for the next PR synchronize run.
  if (baseSha && candidate && resolved) {
    lines.push(`<!-- proove-proof:${Buffer.from(JSON.stringify({ baseSha, headSha, candidate })).toString("base64")} -->`);
  }
  lines.push(`## 🔍 PRoove Review — \`${shortSha}\`${demoLabel}`);
  lines.push("");

  if (resolved && candidate && proof) {
    lines.push("> ✅ **FIX VERIFIED** — The original regression test now passes on the PR head.", "");
    lines.push(`**Head SHA:** \`${headSha}\``);
    lines.push(`**Original bug:** ${candidate.suspectedBug}`);
    lines.push(`**Regression test:** \`base ${statusBadge(proof.baseRun?.status)} / head ${statusBadge(proof.headRun?.status)}\``);
    lines.push("", "<details><summary>Regression test</summary>", "", "```typescript", candidate.testCode, "```", "</details>");
    return lines.join("\n");
  }

  // Error reporting
  if (errorMessage) {
    lines.push(`> ⚠️ **NOT PROVEN** — Review encountered an error.`);
    lines.push("");
    lines.push("**Error:**");
    lines.push("```");
    lines.push(errorMessage);
    lines.push("```");
    lines.push("");
    lines.push(`**Head SHA:** \`${headSha}\``);
    lines.push("---");
    lines.push("*No verified fix available for this commit.*");
    return lines.join("\n");
  }

  // No candidate
  if (!candidate) {
    lines.push(`> ℹ️ **NOT PROVEN** — No regression candidate identified in this diff.`);
    lines.push("");
    lines.push(`**Head SHA:** \`${headSha}\``);
    lines.push("---");
    lines.push("*No verified fix available for this commit.*");
    return lines.join("\n");
  }

  // Proof unsupported (non-demo repository)
  if (proof && !proof.supported) {
    lines.push(`> ℹ️ **NOT PROVEN** — Executable proof is unsupported for this repository.`);
    lines.push("");
    lines.push(`**Suspected bug:** ${candidate.suspectedBug}`);
    lines.push(`**SPEC rule:** *${candidate.specRule}*`);
    lines.push("");
    lines.push("**Proposed regression test:**");
    lines.push("```typescript");
    lines.push(candidate.testCode);
    lines.push("```");
    lines.push("");
    lines.push(`**Head SHA:** \`${headSha}\``);
    lines.push(
      "> Executable proof requires the known demo repository. " +
        "Candidate test shown above is unverified.",
    );
    lines.push("---");
    lines.push("*No verified fix available for this commit.*");
    return lines.join("\n");
  }

  // Full proof result
  const proven = proof?.proven ?? false;
  const verdict = proven ? "🐛 **PROVEN BUG**" : "ℹ️ **NOT PROVEN**";

  lines.push(`> ${verdict}`);
  lines.push("");
  lines.push(`**Head SHA:** \`${headSha}\``);
  lines.push(`**Suspected bug:** ${candidate.suspectedBug}`);
  lines.push(`**SPEC rule:** *${candidate.specRule}*`);
  lines.push("");
  lines.push("### Proposed Regression Test");
  lines.push("```typescript");
  lines.push(candidate.testCode);
  lines.push("```");
  lines.push("");
  lines.push("### Verification Results");
  lines.push("");
  lines.push(
    `| Revision | Result |`,
  );
  lines.push(`|----------|--------|`);
  lines.push(`| Base (correct) | ${statusBadge(proof?.baseRun?.status)} |`);
  lines.push(`| Head (PR)      | ${statusBadge(proof?.headRun?.status)} |`);
  lines.push("");

  if (proven) {
    lines.push(fixUrl ? `### ✅ Verified fix\n[Apply the verified suggestion in Files changed](${fixUrl}) — click **Commit suggestion**.` :
      `### Fix\n${fixStatus ?? "No verified fix available for this commit."}`);
    lines.push("");
  }

  if (proof?.baseRun?.log) {
    lines.push("<details><summary>Base revision test log</summary>");
    lines.push("");
    lines.push("```");
    lines.push(truncateLog(proof.baseRun.log));
    lines.push("```");
    lines.push("</details>");
    lines.push("");
  }

  if (proof?.headRun?.log) {
    lines.push("<details><summary>Head revision test log</summary>");
    lines.push("");
    lines.push("```");
    lines.push(truncateLog(proof.headRun.log));
    lines.push("```");
    lines.push("</details>");
    lines.push("");
  }

  if (!proven && proof?.baseRun && proof?.headRun) {
    const baseStatus = proof.baseRun.status;
    const headStatus = proof.headRun.status;
    if (baseStatus === "FAIL" && headStatus === "FAIL") {
      lines.push("> Both revisions failed — test may be incorrect or candidate is wrong.");
    } else if (baseStatus === "PASS" && headStatus === "PASS") {
      lines.push("> Both revisions passed — candidate test did not detect a regression.");
    } else if (baseStatus !== "PASS") {
      lines.push("> Base revision did not pass — cannot confirm regression.");
    }
    lines.push("");
  }

  lines.push("---");
  if (!proven) lines.push("*No verified fix available for this commit.*");

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
