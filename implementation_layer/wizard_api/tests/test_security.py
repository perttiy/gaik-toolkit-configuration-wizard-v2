import asyncio

import pytest
from helpers import requires_postgres
from pydantic import ValidationError
from wizard_api.config import get_session_output_root
from wizard_api.schemas.session import SessionCreate
from wizard_api.services import agent_service


def test_session_create_rejects_path_traversal_user_id() -> None:
    with pytest.raises(ValidationError):
        SessionCreate(user_id="../etc/passwd")


def test_session_create_rejects_output_dir_outside_root() -> None:
    with pytest.raises(ValidationError):
        SessionCreate(user_id="user-demo", output_dir="/etc/cron.d/evil")
    with pytest.raises(ValidationError):
        SessionCreate(user_id="user-demo", output_dir="../../etc")


def test_session_create_accepts_output_dir_inside_root() -> None:
    root = get_session_output_root()
    session = SessionCreate(user_id="user-demo", output_dir=str(root / "user-demo" / "abc"))
    assert session.output_dir == str((root / "user-demo" / "abc").resolve())


def test_can_use_tool_allows_known_wizard_script() -> None:
    result = asyncio.run(
        agent_service._can_use_tool(
            "Bash", {"command": "python scripts/validate_blueprint.py --blueprint x.json"}, None
        )
    )
    assert result.behavior == "allow"


def test_can_use_tool_denies_arbitrary_command() -> None:
    result = asyncio.run(agent_service._can_use_tool("Bash", {"command": "rm -rf /"}, None))
    assert result.behavior == "deny"


def test_can_use_tool_denies_unlisted_script() -> None:
    result = asyncio.run(
        agent_service._can_use_tool(
            "Bash", {"command": "python scripts/not_a_real_script.py"}, None
        )
    )
    assert result.behavior == "deny"


def test_can_use_tool_allows_non_bash_tools() -> None:
    result = asyncio.run(agent_service._can_use_tool("Read", {"file_path": "x.json"}, None))
    assert result.behavior == "allow"


@requires_postgres
def test_list_sessions_isolated_by_user(client) -> None:
    """User A cannot see user B sessions via list endpoint."""
    create_a = client.post("/sessions", json={"user_id": "user-a", "title": "A"})
    create_b = client.post("/sessions", json={"user_id": "user-b", "title": "B"})
    assert create_a.status_code == 201
    assert create_b.status_code == 201

    list_a = client.get("/sessions", params={"user_id": "user-a"})
    ids = [s["id"] for s in list_a.json()["sessions"]]
    assert create_a.json()["id"] in ids
    assert create_b.json()["id"] not in ids


def test_test_hooks_disabled_by_default(client) -> None:
    assert client.post("/test/shutdown").status_code == 404
