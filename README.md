# PRoove

### An AI review you can reproduce. A fix you can choose to apply.

[![PRoove review](https://github.com/yiaany/PRoove/actions/workflows/proove.yml/badge.svg)](https://github.com/yiaany/PRoove/actions/workflows/proove.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18)

**PRoove turns a suspected regression into an executable experiment.** It asks a model for *one* SPEC-backed test, runs that exact test against the pull request's real base and head commits, and posts a **Proof Card** in the PR conversation. If the test passes on base and fails on head, PRoove tests a proposed repair before offering a native GitHub **Commit suggestion**. Once a human applies it, the same test runs again and the card updates to **FIX VERIFIED**.

> **Scope today:** a working GitHub Actions prototype for the checkout fixture in `fixtures/demo-repo`. This is not a universal reviewer or an automated code-push bot. The model proposes; test results decide; a person applies the fix.

## The loop

```mermaid
flowchart LR
    A[Open PR] --> B[Model proposes one regression test]
    B --> C{Run on actual commits}
    C -->|Base PASS · Head FAIL| D[PROVEN BUG]
    C -->|Anything else| E[NOT PROVEN]
    D --> F[Propose one-line fix]
    F --> G{Run same test on patched head}
    G -->|PASS| H[GitHub suggestion]
    G -->|ERROR or FAIL| I[No suggestion]
    H --> J[Human clicks Commit suggestion]
    J --> K[New PR commit · same test reruns]
    K --> L[FIX VERIFIED]
```

### What the Proof Card shows

| Signal | What it means |
|:--|:--|
| 🐛 **PROVEN BUG** | Documented rule; same new test passes on base and fails on PR head. |
| ✅ **FIX VERIFIED** | After a new PR commit, the *original* regression test passes on base and head. |
| ℹ️ **NOT PROVEN** | No candidate, unsupported fixture, an invalid test, or results that do not demonstrate a regression. |

The top of the comment contains the verdict, base/head SHA, actual test results, measured proof time, SPEC rule, and an action link if a verified suggestion exists. The test source, runner logs, and errors are tucked into expandable sections. **No predicted PASS/FAIL or invented time savings.**

<details>
<summary><strong>See the real demonstration scenario</strong></summary>

1. `SPEC.md` says a discounted price cannot be negative.
2. A PR removes the clamp in `applyDiscount`. Existing tests still pass.
3. A new test checks `applyDiscount(100, 150) === 0`.
4. Base passes, head returns `-50`, so the bug is proven.
5. PRoove verifies a replacement line in a temporary worktree and publishes a GitHub suggestion.
6. Applying it creates a PR commit; the original test passes again.

This full sequence has been observed on [the project's demo PR](https://github.com/yiaany/PRoove/pull/1). The card layout in the current source is a subsequent presentation improvement; run a fresh review to see that layout on GitHub.

</details>

## Install in your GitHub repository

> **Fastest working path:** copy or fork this project **as a whole**, then open a PR from a branch **inside your own repository**. Merely pasting the workflow into an arbitrary codebase will not make PRoove understand that codebase: the fixture, bot, scripts, package files, and build configuration are part of this prototype.

1. Click **Fork** on this repository (or copy the whole project into a repository you administer). In a fork, enable **Actions** under your fork's **Actions** tab before testing. All following steps take place in **your** repository, not in the upstream PRoove repository.
2. Keep `.github/workflows/proove.yml`, `bot/`, `scripts/`, `fixtures/demo-repo/`, `package.json`, `package-lock.json`, and `tsconfig.bot.json` together at the repository root.
3. In **Settings → Secrets and variables → Actions → New repository secret**, create these repository secrets:

   | Secret | Value |
   |:--|:--|
   | `OPENAI_COMPAT_BASE_URL` | Base URL of your OpenAI-compatible Chat Completions endpoint, e.g. `https://api.openai.com/v1` |
   | `OPENAI_COMPAT_API_KEY` | That provider's API key |
   | `OPENAI_COMPAT_MODEL` | Model identifier supported by the same endpoint |

   `GITHUB_TOKEN` is provided by Actions. **Never put a real key into `.env.example`, source code, a PR, or a Git commit.**

4. From a new branch in that **same repository**, replace the checkout return statement in `fixtures/demo-repo/src/checkout.ts`:

   ```diff
   -  return Math.round(Math.max(0, discounted) * 100) / 100;
   +  return Math.round(discounted * 100) / 100;
   ```

5. Open a PR from your new branch **to `main` in that same repository** (if you forked, confirm the base repository is your fork, not the upstream project). Find **PRoove review** in **Actions** and the Proof Card in the PR's **Conversation**. Follow its verified-fix link to **Files changed** → **Commit suggestion** → **Commit changes**. A `synchronize` run updates the same card to **FIX VERIFIED**.

<details>
<summary><strong>Prefer a terminal-only local demo?</strong></summary>

Install Node.js 20+, Git, and dependencies, then run:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run bot:demo
```

`bot:demo` uses **mock model and fix proposals**, real temporary Git commits, and real Vitest processes. It prints a card but never posts to GitHub. Installing packages on a fresh machine requires package registry access; the mock *model* needs no API key.

</details>

## A deliberately narrow proof boundary

- The workflow runs on `pull_request` (`opened`, `reopened`, `synchronize`) for **same-repository** branches. It skips fork PRs rather than exposing repository secrets.
- Proof currently targets `fixtures/demo-repo/src/checkout.ts` and its base-commit `SPEC.md`. Other projects need an explicit fixture/runner adapter; they are **not** automatically supported.
- A fix must target exactly one changed line, pass the same candidate test on a patched copy of the head, and remain attached to the current head SHA. An unsafe, failed, or stale fix is not published.
- The test execution environment omits the model key and GitHub token. An installation or test-collection error is **ERROR**, never evidence of a proven bug.
- `FIX VERIFIED` means **this regression test passed**, not that the entire PR is bug-free.

## Built with IBM Bob IDE

PRoove is a focused developer-review workflow built for the IBM Bob 2.0 Hackathon. Bob IDE belongs in the *development and investigation* story: use it to inspect the SPEC, reason about the failing test, and improve the reviewer; the automated PR comments themselves are produced by GitHub Actions, not by Bob. Relevant Bob task-session summary screenshots belong in `bob_sessions/`.

**[Read the complete documentation](documentation.md)** for installation details, comment states, architecture, model prompts, verification, and limitations.
