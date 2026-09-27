/** Review the actual PR commits, propose one test, and publish the result. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { askModel, type ModelCandidate } from "./model.js";
import { runProof, type FixtureDir } from "./proof.js";
import { buildCommentBody, upsertComment } from "./comment.js";

export interface ReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  repoPath: string;
  fixtureDir: FixtureDir;
  mockModelResponse?: ModelCandidate | null;
  dryRun?: boolean;
  githubToken?: string;
}

export interface ReviewOutput {
  commentBody: string;
  commentUrl?: string;
  proven: boolean;
}

export async function runReview(input: ReviewInput): Promise<ReviewOutput> {
  const { owner, repo, prNumber, baseSha, headSha, repoPath, fixtureDir,
    mockModelResponse, dryRun = false, githubToken } = input;
  const isDemoMode = mockModelResponse !== undefined;
  const root = resolve(repoPath);
  const prefix = fixtureDir === "." ? "" : `${fixtureDir}/`;
  let candidate: ModelCandidate | null = null;
  let proof = null;
  let errorMessage: string | undefined;

  try {
    if (![baseSha, headSha].every((sha) => /^[0-9a-f]{7,40}$/i.test(sha))) {
      throw new Error("Invalid commit SHA");
    }
    // Read only the known fixture's contract and changes. No unrelated PR can
    // produce a proof using the checkout fixture.
    const spec = execFileSync("git", ["show", `${baseSha}:${prefix}SPEC.md`], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024,
    });
    const diff = execFileSync("git", ["diff", "--no-ext-diff", baseSha, headSha,
      "--", `${prefix}src/checkout.ts`], {
      cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    if (diff) {
      candidate = await askModel(spec, diff.slice(0, 8000), mockModelResponse);
      if (candidate) {
        if (!spec.includes(candidate.specRule.trim())) {
          throw new Error("Proposed behavior rule is not present in base SPEC.md");
        }
        proof = await runProof(root, baseSha, headSha, candidate.testCode, fixtureDir);
      }
    }
  } catch (err) {
    errorMessage = String(err);
  }

  const commentBody = buildCommentBody({ headSha, candidate, proof, errorMessage, isDemoMode });
  let commentUrl: string | undefined;
  if (!dryRun) {
    const token = githubToken ?? process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is required to post comment");
    commentUrl = await upsertComment(new Octokit({ auth: token }), owner, repo, prNumber, commentBody);
  }
  return { commentBody, commentUrl, proven: proof?.proven ?? false };
}
