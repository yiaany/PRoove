# PRoove

**GitHub Actions code-review bot that proves regressions with reproducible test evidence.**

PRoove analyzes a pull request, proposes a regression test via an OpenAI-compatible model, runs the exact same test against both the base and head revisions, and posts a single Markdown comment to the PR. If the test passes on base and fails on head, the comment is labeled **PROVEN BUG**. It then proposes a one-line fix, verifies that the same test passes on the patched PR head, and posts a native GitHub review suggestion. A contributor can click **Commit suggestion** to apply it; the next PR run verifies the original test on the new head and reports **FIX VERIFIED**. Otherwise it is **NOT PROVEN** — PRoove never fabricates test output or claims.

---

## How it works

1. A `pull_request` event (opened / reopened / synchronize) triggers the workflow.
2. The bot reads the diff and behavior contract from the actual PR commits.
3. The diff + SPEC are sent to an OpenAI-compatible Chat Completions API.
4. The model proposes **at most one suspected regression** and a new Vitest test.
5. The bot runs the same test against two git worktrees — the PR's actual base SHA and head SHA.
6. Real exit codes determine the verdict: `base PASS + head FAIL → PROVEN BUG`.
7. For a proven bug, a second model request proposes one changed line. PRoove tests it on a temporary head worktree; if it passes, it posts a native GitHub suggestion on the PR diff.
8. Clicking **Commit suggestion** creates a commit on the PR branch. A `synchronize` run repeats the original test and updates the PR timeline comment to **FIX VERIFIED** if it passes.
9. One PR timeline comment (marker `<!-- proove-review -->`) is created or updated by `github-actions[bot]`. Suggestions are deduplicated per head SHA.

---

## Quick-start: same-repository demo PR

### Prerequisites

- Node.js 20+ (for the local demo)
- A GitHub repository where you have write access (this repository: `yiaany/PRoove`)
- An OpenAI-compatible API key (OpenAI, Azure OpenAI, Ollama, etc.)

### Step 1 — Add GitHub Actions Secrets

Go to **GitHub repository → Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name                | Value                                          |
|---------------------------|------------------------------------------------|
| `OPENAI_COMPAT_BASE_URL`  | e.g. `https://api.openai.com/v1`              |
| `OPENAI_COMPAT_API_KEY`   | Your API key                                  |
| `OPENAI_COMPAT_MODEL`     | e.g. `gpt-4o` or `gpt-4o-mini`               |

> `GITHUB_TOKEN` is provided automatically by GitHub Actions — no action required.

### Step 2 — Create a demo branch with the regression

```bash
# From the root of this repository on your local machine:
git checkout -b demo/regression-test
```

Edit `fixtures/demo-repo/src/checkout.ts` — remove the `Math.max(0, ...)` clamp:

```typescript
// Change this line:
return Math.round(Math.max(0, discounted) * 100) / 100;
// To this (introduces the bug):
return Math.round(discounted * 100) / 100;
```

```bash
git add fixtures/demo-repo/src/checkout.ts
git commit -m "demo: introduce negative-price regression"
git push origin demo/regression-test
```

### Step 3 — Open a pull request

Open a PR from `demo/regression-test` → `main` on GitHub.
The PR **must be in the same repository** (not a fork) so secrets are available.

### Step 4 — Watch the workflow

Go to **Actions → PRoove — AI-assisted regression proof** and watch the run.
After it completes, check the PR timeline — PRoove will have posted its comment.
Follow its **Apply the verified suggestion** link to **Files changed**, click **Commit suggestion**, and wait for the next Actions run. The timeline comment should update to **FIX VERIFIED** for the new SHA.

---

## Local demo (no API key, no network)

```bash
npm install
npm run bot:demo
```

This uses **mock model and fix responses** and runs the real proof on a local two-commit
temporary git repository. It prints the exact Markdown that would be posted as a PR
comment. Expect `PROVEN BUG` and a locally verified fix; no GitHub suggestion is created by the local demo.

---

## All scripts

| Command              | Description                                        |
|---------------------|----------------------------------------------------|
| `npm install`        | Install dependencies                               |
| `npm run build`      | Compile TypeScript bot to `dist/`                 |
| `npm run typecheck`  | Type-check all source (no emit)                    |
| `npm test`           | Run all tests with Vitest                          |
| `npm run bot:demo`   | Local demo — mock model + real proof runner        |

---

## Where the comment appears

The comment appears on the **PR timeline** (Conversation tab).
Marker: `<!-- proove-review -->` — re-runs update this comment, not a new one.
A second comment on the changed line in **Files changed** contains the verified `suggestion` block. Applying it requires write access to the PR branch.

---

## Unsupported cases

| Case | Behaviour |
|------|-----------|
| Fork PR | Workflow skips entirely — secrets unavailable. Log message: "skipping: fork PR" |
| PR without changes to `fixtures/demo-repo/src/checkout.ts` | `NOT PROVEN — No regression candidate identified in this diff` |
| Missing demo fixture or executable dependencies | `NOT PROVEN` with an error or unsupported result |
| Model API unreachable | Comment posted with error and `NOT PROVEN` |
| Missing secrets | Workflow fails with a clear error message |
| Candidate fix fails its regression test or cannot target a changed line | No suggestion is posted; the bug remains `PROVEN BUG` with a fix explanation |

---

## Repository layout

```
.github/workflows/proove.yml   GitHub Actions workflow
bot/
  cli.ts                        Entry point (live + demo modes)
  review.ts                     Orchestration
  model.ts                      OpenAI-compatible LLM adapter
  proof.ts                      Worktree-based test execution engine
  comment.ts                    Markdown builder + Octokit PR comment upsert
  suggestion.ts                 Diff line matching + GitHub suggestion posting
fixtures/demo-repo/
  src/checkout.ts               Correct implementation (base revision)
  src/checkout.buggy.ts         Regression version (head revision source)
  tests/checkout.test.ts        Existing passing tests (pass on both revisions)
  SPEC.md                       Behavior contract
scripts/
  create-demo-repo.ts           Creates two-commit temp git repo for proof
tests/                          Bot unit tests (comment, proof, model)
bob_sessions/                   Bob IDE session screenshots (do not modify)
```

---

## .env.example

See [`.env.example`](.env.example) for the required environment variable names.
**Never commit real secrets.**

---

## What was tested locally vs. observed on GitHub

**Tested locally:**
- `npm install` — resolves all dependencies
- `npm run build` — compiles bot TypeScript to `dist/`
- `npm run typecheck` — no type errors
- `npm test` — all unit tests pass (comment builder, mock proof, model mock)
- `npm run bot:demo` — runs proof runner on real two-commit local repo, prints `PROVEN BUG`
- The `createDemoRepo` script creates a valid two-commit git repo with correct/buggy SHAs (local demo only)
- Regression test passes on base SHA and fails on head SHA (verified by `proof.test.ts`)

**Not yet observed on GitHub (requires a real same-repository PR):**
- The GitHub Actions workflow running end-to-end on a real PR
- The model API being called with a real key
- The PR timeline comment appearing on GitHub
- The `GITHUB_TOKEN` comment posting step

---

*Fixes are constrained to a single changed line in the controlled demo fixture; arbitrary-repository automated fixes are not supported.*
