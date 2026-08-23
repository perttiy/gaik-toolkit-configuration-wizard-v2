"""Unit tests for the wizard agent bridge (#29) — pure helpers only.

These do not require the Claude Agent SDK, the `claude` CLI, Foundry creds, or
Postgres. They lock the SSE contract shape (so the Next.js proxy + UI keep
working) and the config guards. The live agent turn is validated against the
proven demo router.
"""

import asyncio
import json

import pytest
from wizard_api.services import agent_service


def test_sse_frames_match_ui_contract():
    assert agent_service.sse({"delta": "hi"}) == 'data: {"delta": "hi"}\n\n'
    # Every frame the UI proxy/client understands round-trips as `data: {json}`.
    for payload in ({"delta": "x"}, {"heartbeat": True}, {"done": True}, {"error": True}):
        frame = agent_service.sse(payload)
        assert frame.startswith("data: ") and frame.endswith("\n\n")
        assert json.loads(frame[len("data: ") :].strip()) == payload


class _FakeStreamEvent:
    def __init__(self, event):
        self.event = event


def test_extract_stream_text_pulls_visible_text_delta():
    ev = _FakeStreamEvent(
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}
    )
    assert agent_service._extract_stream_text(ev) == "Hello"


def test_extract_stream_text_ignores_thinking_and_non_deltas():
    thinking = _FakeStreamEvent(
        {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hmm"}}
    )
    assert agent_service._extract_stream_text(thinking) == ""
    assert agent_service._extract_stream_text(_FakeStreamEvent({"type": "message_start"})) == ""
    assert agent_service._extract_stream_text(object()) == ""


def test_agent_env_never_requires_foundry(monkeypatch):
    # Ambient path: with no Foundry vars the env is still returned (defaults set)
    # so the agent runs on the ambient `claude` CLI auth instead of Foundry.
    for k in agent_service.REQUIRED_FOUNDRY_VARS:
        monkeypatch.delenv(k, raising=False)
    assert agent_service._foundry_configured() is False
    env = agent_service._agent_env()
    assert env["API_TIMEOUT_MS"] == "600000"
    assert env["DISABLE_TELEMETRY"] == "1"


def test_foundry_configured_and_env_passthrough_when_present(monkeypatch):
    for k in agent_service.REQUIRED_FOUNDRY_VARS:
        monkeypatch.setenv(k, "x")
    assert agent_service._foundry_configured() is True
    env = agent_service._agent_env()
    for k in agent_service.REQUIRED_FOUNDRY_VARS:
        assert env[k] == "x"


def test_resolve_wizard_dir_finds_solution_wizard():
    d = agent_service.resolve_wizard_dir()
    assert d is not None and (d / "SKILL.md").is_file()


def test_chat_raises_when_sdk_unavailable(monkeypatch):
    monkeypatch.setattr(agent_service, "_SDK_AVAILABLE", False)
    agent_service.AGENT_SESSIONS.clear()
    with pytest.raises(agent_service.AgentNotConfiguredError):
        asyncio.run(agent_service.get_or_create_session("sid", "/tmp/wizard-x"))


class _ResultLike:
    def __init__(self, total_cost_usd=0.015, duration_ms=200, num_turns=1, usage=None):
        self.total_cost_usd = total_cost_usd
        self.duration_ms = duration_ms
        self.num_turns = num_turns
        self.usage = usage or {"input_tokens": 1, "output_tokens": 1}


def test_log_turn_cost_accumulates_a_running_session_total():
    session = {"session_id": "sid-1", "total_cost_usd": 0.0}
    first = agent_service._log_turn_cost(session, _ResultLike(total_cost_usd=0.01))
    assert first == pytest.approx(0.01)
    second = agent_service._log_turn_cost(session, _ResultLike(total_cost_usd=0.02))
    assert second == pytest.approx(0.03)
    assert session["total_cost_usd"] == pytest.approx(0.03)


def test_log_turn_cost_treats_missing_cost_as_zero():
    session = {"session_id": "sid-2", "total_cost_usd": 0.0}
    total = agent_service._log_turn_cost(session, _ResultLike(total_cost_usd=None))
    assert total == 0.0


# --------------------------------------------------------------------------
# _drain_silent — bootstrap-turn leak fix
#
# Bug: the bootstrap exchange can straddle more than one ResultMessage
# boundary (a tool-use round completing before the model's final text
# settles). The old implementation stopped at the *first* ResultMessage on
# the client's single shared message stream, leaving trailing messages
# un-drained — they then leaked into the user's real first turn as visible
# bootstrap commentary (observed ~1/3 of fresh sessions, #122).
# --------------------------------------------------------------------------


class _FakeResultMessage:
    """Stand-in for claude_agent_sdk.ResultMessage — isinstance checks in
    agent_service only care about the real class, so monkeypatch it too.
    Carries the cost/usage fields _log_turn_cost (#123) reads."""

    def __init__(self, cost_usd: float = 0.01):
        self.total_cost_usd = cost_usd
        self.duration_ms = 100
        self.num_turns = 1
        self.usage = {"input_tokens": 10, "output_tokens": 5}


class _FakeClient:
    """Fake SDK client exposing just enough of receive_messages() for
    _drain_silent — a single continuous async stream, like the real one."""

    def __init__(self, messages):
        self._messages = list(messages)

    async def receive_messages(self):
        for m in self._messages:
            yield m


@pytest.fixture(autouse=True)
def _patch_result_message(monkeypatch):
    monkeypatch.setattr(agent_service, "ResultMessage", _FakeResultMessage)


@pytest.fixture
def _session():
    return {"session_id": "sid-test", "total_cost_usd": 0.0}


def test_drain_silent_stops_after_single_clean_result(_session):
    client = _FakeClient([object(), _FakeResultMessage(cost_usd=0.02)])
    asyncio.run(agent_service._drain_silent(client, _session, grace_seconds=0.05))
    assert _session["total_cost_usd"] == 0.02


def test_drain_silent_drains_a_second_result_message_within_the_grace_window(_session):
    """Exactly the observed bug: bootstrap produces two ResultMessage-
    terminated exchanges back to back. The old code stopped after the first
    and left the second (containing the stray visible text) for the next
    receive_response() call to pick up. The fix must consume both."""
    consumed = []

    class _SlowFakeClient:
        def __init__(self, messages):
            self._messages = list(messages)

        async def receive_messages(self):
            for m in self._messages:
                consumed.append(m)
                # Tiny delay so the two exchanges aren't delivered
                # instantaneously — exercises the real await path in the
                # grace-window peek, not just a synchronous list.
                await asyncio.sleep(0.01)
                yield m

    leaked_text_marker = object()
    messages = [
        object(),  # tool-use round for the bootstrap turn
        _FakeResultMessage(cost_usd=0.01),  # first ResultMessage — old code stopped here
        leaked_text_marker,  # the stray visible commentary that used to leak
        _FakeResultMessage(cost_usd=0.02),  # second ResultMessage — true end of bootstrap
    ]
    client = _SlowFakeClient(messages)
    asyncio.run(
        agent_service._drain_silent(client, _session, grace_seconds=0.5, max_rounds=3)
    )
    assert consumed == messages, "all four bootstrap-turn messages must be drained"
    # Both ResultMessages' cost got counted — a stray leaked ResultMessage
    # would otherwise mean the second turn's cost is silently dropped too.
    assert _session["total_cost_usd"] == pytest.approx(0.03)


def test_drain_silent_respects_max_rounds_as_a_safety_bound(_session):
    """A pathological stream that never stops producing fresh
    ResultMessage-terminated rounds must not hang _drain_silent forever."""

    class _EndlessFakeClient:
        async def receive_messages(self):
            while True:
                yield object()
                yield _FakeResultMessage()

    client = _EndlessFakeClient()
    asyncio.run(
        asyncio.wait_for(
            agent_service._drain_silent(client, _session, grace_seconds=0.01, max_rounds=3),
            timeout=5,
        )
    )


def test_drain_silent_returns_promptly_when_stream_ends_without_a_result(_session):
    """If the stream is exhausted before any ResultMessage ever arrives
    (e.g. the CLI died), don't hang — just return."""
    client = _FakeClient([object(), object()])
    asyncio.run(
        asyncio.wait_for(
            agent_service._drain_silent(client, _session, grace_seconds=0.05), timeout=1
        )
    )
