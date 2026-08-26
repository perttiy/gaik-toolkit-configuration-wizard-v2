# Agent quality eval suite (#121)

Golden-conversation checks for the wizard **agent's own conversational
quality** — pattern classification, asking sensible follow-ups, not
inventing GAIK components that don't exist. Separate from the package-level
evals in E5 (#16, Gate 3/4), which evaluate the *generated PoC*, not the
agent doing the gathering.

## Prerequisites

Same local stack as `solution_wizard_v2/e2e/local-agent-chat-bpmn.spec.ts`:

- Postgres running (`docker compose up -d postgres` in `wizard_api/`)
- `wizard_api` running on `:8100` with a logged-in `claude` CLI (ambient auth
  — no Azure Foundry env vars needed locally):

  ```bash
  cd implementation_layer/wizard_api
  source .venv/bin/activate
  PYTHONPATH=../solution_wizard/src uvicorn wizard_api.main:app --port 8100
  ```

## Running

```bash
cd implementation_layer/wizard_api
source .venv/bin/activate
python3 evals/run_evals.py
```

Run a single conversation while iterating:

```bash
python3 evals/run_evals.py --only audio-maintenance-ticket
```

Each run costs real tokens (real Claude agent calls) and takes roughly
20–40s per conversation. Not part of CI — see #124 for the planned
deterministic-replay (cassette) follow-up that would let a subset run in CI
without live API calls.

## When to run this

Before merging any change to `solution_wizard/SKILL.md`, the pattern
classification list, or the component registry — this is exactly the kind
of change that can silently regress agent behavior with nothing else
catching it (`git diff`-review of a prompt file doesn't tell you whether the
model still classifies things the same way).

## Findings from the first real run (2026-08-23)

3/3 passed — `evals/results/2026-08-23_220708.md`. All three conversations
classified correctly, asked sensible follow-ups, and named no non-registry
component. One thing worth knowing, not a bug in the agent: the eval runner
doesn't set a `locale` on session creation (the production UI does, from a
cookie), so the `audio-maintenance-ticket` run opened its reply partly in
English despite an all-Finnish user message — that's the harness not
pinning locale, not the agent drifting languages on its own. If this suite
grows a locale-consistency check later, pass `locale` explicitly per
conversation first.

The false-positive iteration is worth knowing about too: the first full run
flagged `` `rag` `` as a hallucinated component, because the agent correctly
stated its classification in backticks ("Tämä on klassinen `rag`-tapaus")
and the check's exclusion list only had four of the seven pattern labels.
Fixed by listing all seven. Kept as a reminder that a red eval run means
"something to look at," not automatically "the agent is wrong" — check the
harness's own assumptions first.

## What it checks

Per golden conversation (`golden_conversations.py`):

- **pattern_classification** — the first reply names the expected pattern
  (`audio_to_structured`, `rag`, `vision_extraction`, ...) or an obvious
  natural-language equivalent, not a different one.
- **asks_followup** — the reply asks at least one clarifying question,
  rather than jumping ahead.
- **no_hallucinated_components** — any backtick-quoted, snake_case token
  that reads like a GAIK component reference is checked against the real
  component registry (`solution_wizard/registries/gaik_component_registry.json`).
  Passes vacuously when nothing component-like is mentioned (expected —
  most Phase 1 replies don't reach component selection yet).

Assertions are structural/semantic, not exact-string — the agent's exact
phrasing varies between runs; what shouldn't vary is which pattern it picks
and whether it stays inside the real component registry.

## Output

- Console: pass/fail per check, per conversation.
- `evals/results/<timestamp>.md`: full report with transcripts, for a human
  to skim even when every automated check passes — the checks catch gross
  regressions, not "does this actually read well."

## Adding a golden conversation

Add an entry to `GOLDEN_CONVERSATIONS` in `golden_conversations.py`: an id,
the family/pattern it should classify as, the scripted user turn(s), and the
acceptable classification markers (include a few natural-language phrasings,
not just the raw pattern key — the agent doesn't always say the literal
snake_case label).
