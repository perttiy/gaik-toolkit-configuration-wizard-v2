# bpmnlint-plugin-gaik (S3-2 / #64)

Automates the conventions already tracked manually in
[`bpmn-conventions-gap-notes.md`](./bpmn-conventions-gap-notes.md) — turns
"OK (2026-07-27 fix)" from a one-time manual check into a rule that runs on
every BPMN sync, so a future regression (or a hand-edited canvas) gets
flagged instead of silently drifting from the guide.

Lives at `scripts/bpmnlint-plugin-gaik/` — an in-repo plugin (not published
to npm), resolved directly by `scripts/lint-bpmn.mjs` via a small custom
resolver that falls back to the normal `NodeResolver` for everything else
(`bpmnlint:recommended` and its own rules). Shaped like a real bpmnlint
plugin (`rules` + `configs.recommended`) so it could become its own package
later without changing the rule modules.

## Rules (all `warn` — promote to `error` after PO sign-off)

| Rule | Checks | Example violation |
|------|--------|--------------------|
| `gaik/vague-task-names` | Task label isn't a known-generic placeholder | "Process data", "AI step", "Handle document" |
| `gaik/gateway-question-form` | Gateway label ends in `?` | "Looks fine" instead of "Approved?" |
| `gaik/data-object-is-data` | Data-object name doesn't start with a process verb | "Extract Fields" instead of "Structured Fields" |

`vague-task-names` is a denylist, not a fuzzy heuristic — a P0 warn-first
rule that cries wolf loses trust faster than it catches real problems.
`data-object-is-data` uses a first-word action-verb denylist for the same
reason.

## Verified against the generator's own output

Both the minimal generated sample and a richer one (STT → extraction →
human review → export, i.e. exercising the auto-derived `Approved?`
approval gateway and synthesized data-object labels) produce **zero** GAIK
warnings — the generator's existing naming conventions already comply.
Covered by `lib/bpmn-lint.test.ts` (`"wizard-generated BPMN also passes the
GAIK rules (S3-2)"`).

## Not covered (optional in the ticket, out of scope here)

`[CODE]` prefix requirement on GenAI-lane tasks in implementation
diagrams — the generator already does this per the gap notes above, but
it's not enforced as a lint rule; add if it ever regresses.

## Wiring

No route or UI changes — `app/api/sessions/[id]/bpmn/sync/route.ts` already
treats `lintBpmnXml()`'s output generically (`errors` block the sync,
`warnings` are returned and rendered), so GAIK warnings surface through the
same UI as the existing `bpmnlint:recommended` warnings automatically.
