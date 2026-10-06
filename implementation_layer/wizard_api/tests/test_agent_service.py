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


# ---------------------------------------------------------------------------
# The panel is the only gate approval (#173)
# ---------------------------------------------------------------------------


def test_bootstrap_makes_the_panel_the_only_gate_approval(tmp_path):
    prompt = agent_service._bootstrap_prompt(tmp_path, "fi")

    assert "GATES ARE APPROVED IN THE PANEL, NOT IN THE CHAT" in prompt
    assert 'Do NOT ask\n  them to reply "yes"/"kyllä"' in prompt
    assert (
        "Continue to the next\n  phase only when the state line says that gate is approved"
        in prompt
    )


def test_the_state_line_names_the_step_and_every_gate():
    line = agent_service.gate_context_line(5, {"gate_1": "approved", "gate_2": "pending"})

    assert line == (
        "[Session state: step 5 of 13; gate_1 approved, gate_2 pending, "
        "gate_3 pending, gate_4 pending]"
    )
    assert agent_service.with_gate_context("kyllä", 5, {}).endswith("]\n\nkyllä")


# ---------------------------------------------------------------------------
# The agent's context survives a restart or an idle reap (#174)
# ---------------------------------------------------------------------------


def test_the_cli_state_lives_on_the_sessions_volume(monkeypatch):
    monkeypatch.delenv("WIZARD_AGENT_STATE_DIR", raising=False)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", "/data/sessions")

    assert agent_service._agent_env()["CLAUDE_CONFIG_DIR"] == "/data/sessions/.claude-agent"

    monkeypatch.setenv("WIZARD_AGENT_STATE_DIR", "/state/agent")
    assert agent_service._agent_env()["CLAUDE_CONFIG_DIR"] == "/state/agent"

    # Local dev with the ambient CLI: nothing configured, the CLI keeps its own state.
    monkeypatch.delenv("WIZARD_AGENT_STATE_DIR", raising=False)
    monkeypatch.delenv("WIZARD_SESSION_OUTPUT_ROOT", raising=False)
    assert "CLAUDE_CONFIG_DIR" not in agent_service._agent_env()


def test_the_restored_transcript_tells_the_agent_to_continue_not_restart():
    messages = [{"role": "user", "content": f"message {i}"} for i in range(20)]
    messages.append({"role": "assistant", "content": "x" * 2000})

    prompt = agent_service.restore_context_prompt(messages)

    assert "CONTEXT RESTORED AFTER A RESTART" in prompt
    assert "Do NOT restart the interview" in prompt
    assert "User: message 19" in prompt and "User: message 7" not in prompt  # last 12 only
    assert "You: " + "x" * 1500 + " …" in prompt  # long replies are cut
    assert agent_service.restore_context_prompt([]) == ""
    assert agent_service.restore_context_prompt(None) == ""


def test_the_notice_exists_in_both_ui_languages():
    assert set(agent_service.RESTART_NOTICE) == {"fi", "en"}
    assert all(text.endswith("\n\n") for text in agent_service.RESTART_NOTICE.values())


def test_build_options_pass_the_session_to_resume(tmp_path):
    pytest.importorskip("claude_agent_sdk")
    options = agent_service._build_options(tmp_path, tmp_path, resume="sdk-123")
    assert options.resume == "sdk-123"
    assert agent_service._build_options(tmp_path, tmp_path).resume is None


def test_the_stream_remembers_the_cli_session_id():
    sdk = pytest.importorskip("claude_agent_sdk")

    class _Client:
        async def query(self, text):
            pass

        async def receive_response(self):
            yield sdk.AssistantMessage(content=[sdk.TextBlock(text="ok")], model="m")
            yield sdk.ResultMessage(
                subtype="success",
                duration_ms=1,
                duration_api_ms=1,
                is_error=False,
                num_turns=1,
                session_id="sdk-777",
            )

    session = {"client": _Client(), "id": "t", "last_active": 0}
    parts: list[str] = []

    async def go():
        return [f async for f in agent_service._stream_turn(session, parts)]

    asyncio.run(go())

    assert session["sdk_session_id"] == "sdk-777"
