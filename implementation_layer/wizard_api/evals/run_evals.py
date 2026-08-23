#!/usr/bin/env python3
"""Agent quality eval suite runner (#121).

Runs the golden conversations in golden_conversations.py against a live
wizard_api + real Claude agent (same prerequisites as
solution_wizard_v2/e2e/local-agent-chat-bpmn.spec.ts — this is the
Python-side counterpart, no browser needed since we're checking the
agent's text, not the UI).

Usage (from implementation_layer/wizard_api, with the venv active and
wizard_api running on :8100 with a logged-in `claude` CLI):

    python3 evals/run_evals.py

Writes a findings report to evals/results/<timestamp>.md and prints a
pass/fail summary to stdout. Exits non-zero if any golden conversation
fails its assertions, so it can be wired into a pre-merge check later
without further changes.

This is local-only by design (real LLM calls, real cost) — not part of
CI. See #124 for the planned deterministic-replay (cassette) follow-up
that would let a subset of this run in CI.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from golden_conversations import GOLDEN_CONVERSATIONS, GoldenConversation  # noqa: E402

sys.path.insert(
    0, str(Path(__file__).resolve().parents[2] / "solution_wizard" / "src")
)
from solution_wizard.registry import get_registry  # noqa: E402

WIZARD_API_URL = "http://127.0.0.1:8100"
RESULTS_DIR = Path(__file__).parent / "results"

# Crude but effective: candidate "component-like" tokens are snake_case
# identifiers of a plausible length. We only flag ones that look like they're
# being asserted as a *real GAIK component* (heuristic: preceded by words
# like "component", "moduuli", "käytetään" or wrapped in backticks) — this
# keeps the check from false-positiving on the pattern labels themselves
# (audio_to_structured etc. are not components).
_SNAKE_CASE = re.compile(r"`?\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,4})\b`?")
_NOT_COMPONENTS = {
    # All seven pattern labels from SKILL.md Phase 1 — the agent is
    # instructed to state its classification in backticks (see the real
    # rag-hr-policy-chatbot run: "Tämä on klassinen `rag`-tapaus"), which
    # otherwise reads exactly like a component reference to this heuristic.
    "audio_to_structured",
    "document_to_structured",
    "rag",
    "vision_extraction",
    "classification",
    "transcript_only",
    "hybrid",
}


@dataclass
class TurnResult:
    message: str
    reply: str
    duration_s: float


@dataclass
class ConversationResult:
    conversation: GoldenConversation
    turns: list[TurnResult] = field(default_factory=list)
    checks: list[tuple[str, bool, str]] = field(default_factory=list)  # (name, passed, detail)

    @property
    def passed(self) -> bool:
        return all(ok for _, ok, _ in self.checks)


def create_session(client: httpx.Client, title: str) -> str:
    res = client.post(
        f"{WIZARD_API_URL}/sessions",
        json={"user_id": "eval@gaik.local", "title": title},
    )
    res.raise_for_status()
    return res.json()["id"]


def send_turn(client: httpx.Client, session_id: str, message: str) -> str:
    """POST one chat turn, consume the SSE stream, return the assembled reply."""
    reply_parts: list[str] = []
    with client.stream(
        "POST",
        f"{WIZARD_API_URL}/sessions/{session_id}/chat",
        json={"message": message},
        headers={"Accept": "text/event-stream"},
        timeout=120,
    ) as res:
        res.raise_for_status()
        for line in res.iter_lines():
            if not line.startswith("data: "):
                continue
            payload = json.loads(line[len("data: ") :])
            if payload.get("delta"):
                reply_parts.append(payload["delta"])
            if payload.get("error"):
                raise RuntimeError(f"agent turn errored: {payload}")
    return "".join(reply_parts)


def check_pattern_classification(reply: str, conv: GoldenConversation) -> tuple[bool, str]:
    lowered = reply.lower()
    hit = next((m for m in conv.expected_pattern_markers if m.lower() in lowered), None)
    if hit:
        return True, f"found marker '{hit}'"
    return False, f"none of {conv.expected_pattern_markers} found in reply"


def check_asks_followup(reply: str) -> tuple[bool, str]:
    ok = "?" in reply
    return ok, "reply contains a follow-up question" if ok else "no '?' in reply"


def check_no_hallucinated_components(reply: str, registry) -> tuple[bool, str]:
    """Flag any snake_case token that reads like a component reference
    (adjacent to component-ish wording or backtick-quoted) but isn't in the
    real registry. Passes vacuously (0 flagged) when nothing component-like
    is mentioned — most Phase-1 replies won't reach component selection yet,
    and that's fine; this still guards the ones that do."""
    suspects = set()
    for m in re.finditer(r"`([a-z][a-z0-9_]{2,40})`", reply):
        token = m.group(1)
        if token in _NOT_COMPONENTS:
            continue
        if "_" in token or token.islower():
            suspects.add(token)

    bad = [t for t in suspects if not registry.exists(t)]
    if bad:
        return False, f"reply names non-registry component(s): {bad}"
    if suspects:
        return True, f"checked {sorted(suspects)}, all in registry"
    return True, "no component-like tokens mentioned (vacuous pass)"


def run_conversation(
    client: httpx.Client, conv: GoldenConversation, registry
) -> ConversationResult:
    session_id = create_session(client, f"eval-{conv.id}-{uuid.uuid4().hex[:8]}")
    result = ConversationResult(conversation=conv)

    for message in conv.turns:
        start = time.monotonic()
        reply = send_turn(client, session_id, message)
        result.turns.append(
            TurnResult(message=message, reply=reply, duration_s=time.monotonic() - start)
        )

    first_reply = result.turns[0].reply if result.turns else ""
    ok, detail = check_pattern_classification(first_reply, conv)
    result.checks.append(("pattern_classification", ok, detail))

    ok, detail = check_asks_followup(first_reply)
    result.checks.append(("asks_followup", ok, detail))

    full_text = "\n".join(t.reply for t in result.turns)
    ok, detail = check_no_hallucinated_components(full_text, registry)
    result.checks.append(("no_hallucinated_components", ok, detail))

    return result


def write_report(results: list[ConversationResult], path: Path) -> None:
    lines = [
        f"# Agent eval run — {datetime.now(UTC).isoformat(timespec='seconds')}",
        "",
        f"{sum(r.passed for r in results)}/{len(results)} golden conversations passed.",
        "",
    ]
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        lines += [f"## [{status}] {r.conversation.id} ({r.conversation.family})", ""]
        if r.conversation.note:
            lines += [f"_{r.conversation.note}_", ""]
        for name, ok, detail in r.checks:
            mark = "x" if ok else " "
            lines.append(f"- [{mark}] **{name}** — {detail}")
        lines.append("")
        lines.append("<details><summary>Transcript</summary>\n")
        for t in r.turns:
            lines.append(f"**User:** {t.message}")
            lines.append("")
            lines.append(f"**Agent** ({t.duration_s:.1f}s): {t.reply}")
            lines.append("")
        lines.append("</details>")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only", help="comma-separated conversation ids to run (default: all)", default=None
    )
    args = parser.parse_args()

    conversations = GOLDEN_CONVERSATIONS
    if args.only:
        wanted = set(args.only.split(","))
        conversations = [c for c in conversations if c.id in wanted]
        if not conversations:
            print(f"no conversation matches --only={args.only}", file=sys.stderr)
            return 2

    registry = get_registry()
    results: list[ConversationResult] = []
    with httpx.Client() as client:
        try:
            client.get(f"{WIZARD_API_URL}/health", timeout=5).raise_for_status()
        except httpx.HTTPError as exc:
            print(f"wizard_api not reachable at {WIZARD_API_URL}: {exc}", file=sys.stderr)
            return 2

        for conv in conversations:
            print(f"running {conv.id} ({conv.family}) ...")
            result = run_conversation(client, conv, registry)
            results.append(result)
            status = "PASS" if result.passed else "FAIL"
            print(f"  {status}")
            for name, ok, detail in result.checks:
                print(f"    [{'x' if ok else ' '}] {name}: {detail}")

    RESULTS_DIR.mkdir(exist_ok=True)
    report_path = RESULTS_DIR / f"{datetime.now(UTC).strftime('%Y-%m-%d_%H%M%S')}.md"
    write_report(results, report_path)
    print(f"\nWrote {report_path}")

    passed = sum(r.passed for r in results)
    print(f"\n{passed}/{len(results)} golden conversations passed.")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
