"""BPMN API routes — generate, blueprint patch, canvas sync."""

from helpers import requires_postgres
from wizard_api.services import bpmn_service

requires_solution_wizard = __import__("pytest").mark.skipif(
    not bpmn_service.solution_wizard_available(),
    reason="solution_wizard package not installed",
)

SAMPLE_BLUEPRINT = {
    "name": "Chatbot",
    "description": "Test",
    "goal": "Automate Q&A",
    "steps": [
        {"id": "input", "name": "User question", "type": "io"},
        {"id": "rag", "name": "RAG search", "type": "ai", "component": "pgvector"},
        {"id": "review", "name": "Human review", "type": "human_review"},
    ],
}


@requires_postgres
@requires_solution_wizard
def test_get_session_bpmn_returns_xml(client) -> None:
    create = client.post(
        "/sessions",
        json={"user_id": "bpmn-user", "title": "BPMN test"},
    )
    assert create.status_code == 201
    session_id = create.json()["id"]

    patched = client.patch(
        f"/sessions/{session_id}/blueprint",
        json={"content": SAMPLE_BLUEPRINT, "note": "Seed for BPMN"},
    )
    assert patched.status_code == 200

    bpmn = client.get(f"/sessions/{session_id}/bpmn")
    assert bpmn.status_code == 200
    assert "application/xml" in bpmn.headers.get("content-type", "")
    assert "<bpmn:definitions" in bpmn.text
    assert "RAG search" in bpmn.text


@requires_postgres
@requires_solution_wizard
def test_patch_blueprint_creates_new_version(client) -> None:
    create = client.post("/sessions", json={"user_id": "bp-user", "title": "Patch test"})
    session_id = create.json()["id"]
    assert create.json()["active_version"] == 1

    patched = client.patch(
        f"/sessions/{session_id}/blueprint",
        json={"content": SAMPLE_BLUEPRINT},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["active_version"] == 2
    assert body["blueprint"]["steps"][1]["name"] == "RAG search"


@requires_postgres
@requires_solution_wizard
def test_bpmn_sync_updates_blueprint_from_canvas(client) -> None:
    create = client.post("/sessions", json={"user_id": "sync-user", "title": "Sync test"})
    session_id = create.json()["id"]
    client.patch(
        f"/sessions/{session_id}/blueprint",
        json={"content": SAMPLE_BLUEPRINT},
    )

    bpmn = client.get(f"/sessions/{session_id}/bpmn")
    assert bpmn.status_code == 200
    edited = bpmn.text.replace("RAG search", "Vector retrieval")

    synced = client.post(
        f"/sessions/{session_id}/bpmn/sync",
        json={"xml": edited},
    )
    assert synced.status_code == 200
    steps = synced.json()["blueprint"]["steps"]
    names = [s["name"] for s in steps]
    assert "Vector retrieval" in names


@requires_postgres
@requires_solution_wizard
def test_blueprint_ops_rename_step(client) -> None:
    create = client.post("/sessions", json={"user_id": "ops-user", "title": "Ops test"})
    session_id = create.json()["id"]
    client.patch(
        f"/sessions/{session_id}/blueprint",
        json={"content": SAMPLE_BLUEPRINT},
    )
    res = client.post(
        f"/sessions/{session_id}/blueprint/ops",
        json={
            "ops": [{"op": "rename_step", "step_id": "rag", "name": "Retrieve Context"}],
            "note": "rename via ops",
        },
    )
    assert res.status_code == 200
    steps = {s["id"]: s for s in res.json()["blueprint"]["steps"]}
    assert steps["rag"]["name"] == "Retrieve Context"
    assert res.json()["active_version"] >= 3


@requires_postgres
@requires_solution_wizard
def test_restore_blueprint_version(client) -> None:
    create = client.post("/sessions", json={"user_id": "restore-user", "title": "Restore"})
    session_id = create.json()["id"]
    client.patch(
        f"/sessions/{session_id}/blueprint",
        json={"content": SAMPLE_BLUEPRINT, "note": "v2"},
    )
    client.post(
        f"/sessions/{session_id}/blueprint/ops",
        json={
            "ops": [{"op": "rename_step", "step_id": "rag", "name": "Changed"}],
        },
    )
    before = client.get(f"/sessions/{session_id}").json()
    assert before["active_version"] == 3
    assert len(before["versions"]) == 3

    restored = client.post(f"/sessions/{session_id}/versions/2/restore", json={})
    assert restored.status_code == 200
    body = restored.json()
    # Append-only undo: new version, history kept
    assert body["active_version"] == 4
    assert len(body["versions"]) == 4
    assert "Restored" in (body["versions"][-1].get("note") or "")
    steps = {s["id"]: s for s in body["blueprint"]["steps"]}
    assert steps["rag"]["name"] == "RAG search"


@requires_postgres
@requires_solution_wizard
def test_restore_missing_version_returns_404(client) -> None:
    create = client.post("/sessions", json={"user_id": "restore-404", "title": "Missing"})
    session_id = create.json()["id"]
    res = client.post(f"/sessions/{session_id}/versions/99/restore", json={})
    assert res.status_code == 404


@requires_postgres
@requires_solution_wizard
def test_restore_as_one_step_undo(client) -> None:
    """Undo = restore previous active version (n-1)."""
    create = client.post("/sessions", json={"user_id": "undo-user", "title": "Undo"})
    session_id = create.json()["id"]
    client.patch(
        f"/sessions/{session_id}/blueprint",
        json={"content": SAMPLE_BLUEPRINT, "note": "good"},
    )
    client.post(
        f"/sessions/{session_id}/blueprint/ops",
        json={"ops": [{"op": "rename_step", "step_id": "input", "name": "Oops"}]},
    )
    active = client.get(f"/sessions/{session_id}").json()["active_version"]
    undone = client.post(
        f"/sessions/{session_id}/versions/{active - 1}/restore",
        json={"note": "Undo last change"},
    )
    assert undone.status_code == 200
    steps = {s["id"]: s for s in undone.json()["blueprint"]["steps"]}
    assert steps["input"]["name"] == "User question"
    assert undone.json()["active_version"] == active + 1
