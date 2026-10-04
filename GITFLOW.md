# GitFlow — Fork Development Process

This document describes the branching model and commit conventions for this fork
(`perttiy/gaik-toolkit-configuration-wizard-v2`): which branch runs where, how a
change gets in, and what a commit and a PR must look like. Updated 3 Oct 2026 to
match how the team actually works (`sync-v1` / `sprint4`, squash merges).

For coding guidelines (module structure, tests, releases), see
[`guidance_layer/CONTRIBUTING.md`](guidance_layer/CONTRIBUTING.md).

---

## Branch roles

| Branch | Purpose | Who merges here |
|--------|---------|-----------------|
| **`main`** | Mirror of upstream `GAIK-project/gaik-toolkit` as last synced; the repository's default branch. Not where the fork's work lands. | Maintainer, upstream sync only |
| **`sync-v1`** | The Rahti line: what the staging stack runs. Every change PR lands here first. | Pertti, squash merge of reviewed PRs |
| **`sprint4`** | Integration branch of the sprint's PoC chain (sandbox, runner, PoC run). Contains `sync-v1` plus the sprint work; the `s4` Rahti instance runs it. | Pertti, by **merging `sync-v1`** into it (not cherry-picks) and squash-merging PRs that exist only for the sprint |
| **`dev`** | Older integration branch; superseded by `sync-v1` for new work. | — |
| **`fix/*`, `feat/*`, `ci/*`, `docs/*`, `test/*`** | One change each, branched from `sync-v1` (or from `sprint4` when the change touches files that only exist there, say in the PR why) | — (merge target: `sync-v1`) |

### Rules

- **Never commit directly to `sync-v1` or `sprint4`.** Every change is a reviewed pull request; ask the other developer for the review (`--reviewer`).
- **One PR per change, base `sync-v1`.** Do not open a second "port" PR against `sprint4`; `sprint4` receives `sync-v1` by a merge, which brings everything in one step with no duplicate commits.
- **CI must be green** on the PR before it merges (see *CI triggers*). A commit that CI never saw cannot be deployed.
- **Delete feature branches** after they are merged.
- **Upstream code is upstream's.** `implementation_layer/solution_wizard/` (the V1 wizard: SKILL.md, scripts, registries, the Python package) and `implementation_layer/src/gaik/` belong to the GAIK team. A change there is proposed upstream, not kept in the fork, unless agreed with Pertti first. `wizard_api/`, `solution_wizard_v2/`, `deploy/` and the workflows are the fork's own.

---

## Daily workflow

### Start a new change

```bash
git checkout sync-v1
git pull origin sync-v1
git checkout -b fix/short-description      # or feat/, ci/, docs/, test/
```

Use a short, kebab-case slug that describes the change, e.g. `fix/chat-no-canned-reply`.

### Work, commit, push

```bash
git add <files>
git commit
git push -u origin feature/short-description
```

Open a **pull request into `sync-v1`** and request the other developer as reviewer.
Wait for CI to pass before merging. Pertti merges with **squash**, so the PR title
becomes the commit subject on `sync-v1` — write it as one.

### Bring `sync-v1` into `sprint4`

When PRs have landed on `sync-v1`, merge it into `sprint4` once:

```bash
git checkout sprint4 && git pull origin sprint4
git merge origin/sync-v1          # a merge, not cherry-picks
git push origin sprint4
```

### Deploy

A `wizard-v2*` tag (never `v*.*.*`, that publishes the `gaik` package to PyPI)
deploys the staging stack; a second instance is deployed with *Run workflow* and
the `instance` input, or with `INSTANCE=<name> ./deploy.sh` by hand. The
workflow refuses a commit whose checks are not all green.

### Hotfix (urgent production fix)

```bash
git checkout main
git pull origin main
git checkout -b hotfix/short-description
# fix, commit, push
# PR → main, then merge main back into dev
```

---

## Syncing with upstream

This fork tracks the upstream GAIK toolkit. Add the upstream remote once:

```bash
git remote add upstream https://github.com/GAIK-project/gaik-toolkit.git
```

To pull upstream changes into the fork:

```bash
git fetch upstream
git checkout dev
git merge upstream/dev    # or: git rebase upstream/dev
# resolve conflicts, run tests, push
git push origin dev
```

After upstream sync is verified, open a PR from `dev` → `main` to promote stable changes.

---

## Commit message conventions

Every commit must be documented clearly so the history is readable without opening
the diff. We follow [Conventional Commits](https://www.conventionalcommits.org/)
— the same style already used in this repository.

### Format

```
<type>(<scope>): <short summary>

<optional body — explain why, not just what>

<optional footer — issue refs, breaking changes>
```

### Subject line (first line)

- Use the imperative mood: `add`, `fix`, `update` — not `added` or `fixes`
- Keep it ≤ 72 characters
- No trailing period
- Scope is optional but encouraged when the change is localized

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or user-visible behaviour |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependencies |
| `style` | Formatting, whitespace (no logic change) |
| `perf` | Performance improvement |

### Scope examples

Use the area of the codebase affected:

- `solution-wizard`, `demo-app`, `transcriber`, `RAG`, `skills`, `website`, `ci`

### Body (required when the change is non-trivial)

Write 1–5 lines explaining:

- **Why** the change was made (problem, requirement, context)
- **What** changed at a high level (if not obvious from the subject)
- **How to verify** (test command, manual step) when helpful

### Footer

- Reference issues: `Closes #42`, `Refs #17`
- Breaking changes: start a paragraph with `BREAKING CHANGE:` describing migration steps

### Examples

**Simple fix:**

```
fix(parallel_transcriber): raise api_timeout_seconds default 180→600
```

**Feature with body:**

```
feat(admin): per-user report limit override + summary stats

Allow admins to set individual report quotas per user and view
aggregate usage in the admin panel. Defaults remain unchanged for
existing users.

Test: pytest implementation_layer/unit_tests/ -k admin
```

**Documentation:**

```
docs: add GitFlow branching model for fork development

Documents main/dev workflow, upstream sync, and commit conventions
so contributors follow a consistent process.
```

**Breaking change:**

```
refactor(evaluation_layer): move output methods to evaluation_layer/

BREAKING CHANGE: import paths changed from
implementation_layer/evaluation/ to evaluation_layer/. Update imports
before upgrading.
```

### Issue reference

Put the issue or finding the change answers in the subject when there is one:
`fix(wizard-api): enforce the approval gates on the server (#187)`. A reviewer
should be able to go from the commit to the reason without the PR.

### Authorship and tooling

The author of a commit is the person who stands behind it. Whatever editor,
assistant or generator helped, **it is not named in the commit or the PR**:

- no `Co-Authored-By:` lines for tools, no `Generated with …` footers or badges,
  no tool or model names in messages or PR descriptions;
- commits are made under your own name and e-mail, not a tool's identity.

This is a customer deliverable, and attribution to a person is part of it.
Review your own diff before you push, as you would for code you typed.

### Before you commit

Run the formatter and linter the CI runs, so a style-only follow-up commit is
never needed:

```bash
uvx ruff@0.14.10 format implementation_layer/wizard_api implementation_layer/solution_wizard
uvx ruff@0.14.10 check  implementation_layer/wizard_api implementation_layer/solution_wizard
cd implementation_layer/solution_wizard_v2 && npx tsc --noEmit && npx vitest run
```

### What to avoid

- Vague messages: `fix stuff`, `update`, `wip`, `changes`
- Mixing unrelated changes in one commit
- Commit messages that only restate the diff without context
- A PR description that claims something a test does not show ("runs the PoC" when the test accepts a 503)

---

## Pull request checklist

Before merging into `sync-v1` (the template in `.github/PULL_REQUEST_TEMPLATE.md`
asks for these):

- [ ] Base is `sync-v1` (or the PR says why it is `sprint4`)
- [ ] CI passes (ruff, pytest, vitest, tsc, e2e)
- [ ] Commit messages follow the conventions above; no tool attribution anywhere
- [ ] PR description says what the problem was, what changed, what it does not do, and how it was tested
- [ ] No secrets, credentials, `.env` files or customer material committed
- [ ] No change under `solution_wizard/` or `src/gaik/` without agreement (see *Rules*)

---

## CI triggers

`solution-wizard-v2.yml` (ruff, wizard_api and solution_wizard tests, vitest,
tsc, e2e) runs on:

- Push to `main`, `dev`, `sync-v1` or `sprint4`
- Pull requests targeting any of those

`wizard-v2-acceptance.yml` runs the Docker stack specs on a push to `dev`,
`sync-v1` or `sprint4`; its schedule runs only from the repository's default
branch, which is still `main`.

`wizard-v2-deploy.yml` deploys on a `wizard-v2*` tag or by *Run workflow*, and
only when the commit's checks are green.

Publishing to PyPI is triggered only by version tags (`v*.*.*`). Do not use that
pattern for wizard milestones.
