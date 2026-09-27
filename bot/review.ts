/** Review the actual PR commits, propose one test, and publish the result. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { askModel, askFix, type ModelCandidate, type FixCandidate } from "./model.js";
import { runProof, verifyFix, type FixtureDir } from "./proof.js";
import { buildCommentBody, upsertComment, getExistingComment, readStoredProof } from "./comment.js";
import { locateFix, originalLineFix, publishSuggestion } from "./suggestion.js";

export interface ReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  repoPath: string;
  fixtureDir: FixtureDir;
  mockModelResponse?: ModelCandidate | null;
  mockFixResponse?: FixCandidate | null;
  previousCommentBody?: string;
  dryRun?: boolean;
  githubToken?: string;
}

export interface ReviewOutput {
  commentBody: string;
  commentUrl?: string;
  proven: boolean;
  resolved: boolean;
}

export async function runReview(input: ReviewInput): Promise<ReviewOutput> {
  const { owner, repo, prNumber, baseSha, headSha, repoPath, fixtureDir,
    mockModelResponse, mockFixResponse, previousCommentBody, dryRun = false, githubToken } = input;
  const isDemoMode = mockModelResponse !== undefined;
  const root = resolve(repoPath);
  const prefix = fixtureDir === "." ? "" : `${fixtureDir}/`;
  let candidate: ModelCandidate | null = null;
  let proof = null;
  let errorMessage: string | undefined;
  let fixUrl: string | undefined;
  let fixStatus: string | undefined;
  let resolved = false;
  const token = githubToken ?? process.env.GITHUB_TOKEN;
  const octokit = !dryRun && token ? new Octokit({ auth: token }) : null;

  try {
    if (![baseSha, headSha].every((sha) => /^[0-9a-f]{7,40}$/i.test(sha))) {
      throw new Error("Invalid commit SHA");
    }
    // Read only the known fixture's contract and changes. No unrelated PR can
    // produce a proof using the checkout fixture.
    const spec = execFileSync("git", ["show", `${baseSha}:${prefix}SPEC.md`], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024,
    });
    const previous = previousCommentBody ??
      (octokit ? (await getExistingComment(octokit, owner, repo, prNumber))?.body : undefined);
    const stored = previous ? readStoredProof(previous) : null;
    if (stored?.baseSha === baseSha) {
      const oldProof = await runProof(root, baseSha, headSha, stored.candidate.testCode, fixtureDir);
      if (oldProof.baseRun?.status === "PASS" && oldProof.headRun?.status === "PASS") {
        candidate = stored.candidate;
        proof = oldProof;
        resolved = true;
      } else if (stored.headSha === headSha && oldProof.proven) {
        candidate = stored.candidate;
        proof = oldProof;
      }
    }
    const diff = execFileSync("git", ["diff", "--no-ext-diff", baseSha, headSha,
      "--", `${prefix}src/checkout.ts`], {
      cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    if (!resolved && !candidate && diff) {
      candidate = await askModel(spec, diff.slice(0, 8000), mockModelResponse);
      if (candidate) {
        if (!spec.includes(candidate.specRule.trim())) {
          throw new Error("Proposed behavior rule is not present in base SPEC.md");
        }
        proof = await runProof(root, baseSha, headSha, candidate.testCode, fixtureDir);
      }
    }
    if (!resolved && candidate && proof?.proven) {
      try {
        const source = execFileSync("git", ["show", `${headSha}:${prefix}src/checkout.ts`],
          { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 });
        let located = null;
        try {
          const proposed = await askFix(spec, diff, candidate, source, mockFixResponse);
          located = proposed && locateFix(diff, source, proposed);
        } catch (err) {
          console.warn(`Model fix unavailable; trying verified one-line fallback: ${String(err)}`);
        }
        located ??= originalLineFix(diff, source);
        if (!located) {
          fixStatus = "No safe single-line suggestion matched the PR diff.";
        } else {
          const verified = await verifyFix(root, headSha, candidate.testCode,
            located.oldLine, located.newLine, fixtureDir);
          if (verified.status !== "PASS") {
            fixStatus = `Suggested change was not published: verification ${verified.status}.`;
          } else if (octokit) {
            fixUrl = await publishSuggestion(octokit, owner, repo, prNumber, headSha,
              `${prefix}src/checkout.ts`, located);
          } else {
            fixStatus = "Verified fix available; GitHub suggestion is published only in a live PR.";
          }
        }
      } catch (err) {
        fixStatus = `Fix suggestion unavailable: ${String(err).slice(0, 300)}`;
      }
    }
  } catch (err) {
    errorMessage = String(err);
  }

  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = !dryRun && server && repository && /^\d+$/.test(runId ?? "") ?
    `${server}/${repository}/actions/runs/${runId}` : undefined;
  const commentBody = buildCommentBody({ baseSha, headSha, candidate, proof, errorMessage,
    isDemoMode, fixUrl, fixStatus, resolved, runUrl });
  let commentUrl: string | undefined;
  if (!dryRun) {
    if (!token) throw new Error("GITHUB_TOKEN is required to post comment");
    commentUrl = await upsertComment(octokit!, owner, repo, prNumber, commentBody);
  }
  return { commentBody, commentUrl, proven: proof?.proven ?? false, resolved };
}
