"""Blueprint change-ops (S3-4/#66) and version restore (S3-5/#67) routes."""

from helpers import requires_postgres

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
def test_apply_ops_renames_a_step_and_creates_a_new_version(client) -> None:
    create = client.post("/sessions", json={"user_id": "ops-user", "title": "Ops test"})
    session_id = create.json()["id"]
    client.patch(f"/sessions/{session_id}/blueprint", json={"content": SAMPLE_BLUEPRINT})

    res = client.post(
        f"/sessions/{session_id}/blueprint/ops",
        json={"ops": [{"op": "rename_step", "step_id": "rag", "name": "Vector retrieval"}]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["active_version"] == 3  # v1 seed -> v2 patch -> v3 ops
    names = [s["name"] for s in body["blueprint"]["steps"]]
    assert "Vector retrieval" in names
    assert "RAG search" not in names


@requires_postgres
def test_apply_ops_rejects_unsupported_op(client) -> None:
    create = client.post("/sessions", json={"user_id": "ops-user-2", "title": "Bad op test"})
    session_id = create.json()["id"]

    res = client.post(
        f"/sessions/{session_id}/blueprint/ops",
        json={"ops": [{"op": "delete_everything"}]},
    )
    assert res.status_code == 400


@requires_postgres
def test_apply_ops_rejects_unknown_step_id(client) -> None:
    create = client.post("/sessions", json={"user_id": "ops-user-3", "title": "Unknown step test"})
    session_id = create.json()["id"]

    res = client.post(
        f"/sessions/{session_id}/blueprint/ops",
        json={"ops": [{"op": "rename_step", "step_id": "does-not-exist", "name": "x"}]},
    )
    assert res.status_code == 400


@requires_postgres
def test_apply_ops_missing_ops_list_is_rejected(client) -> None:
    create = client.post("/sessions", json={"user_id": "ops-user-4", "title": "Empty ops test"})
    session_id = create.json()["id"]

    res = client.post(f"/sessions/{session_id}/blueprint/ops", json={"ops": []})
    assert res.status_code == 422  # pydantic min_length=1


@requires_postgres
def test_restore_version_copies_old_content_forward_as_a_new_version(client) -> None:
    create = client.post("/sessions", json={"user_id": "restore-user", "title": "Restore test"})
    session_id = create.json()["id"]
    assert create.json()["active_version"] == 1
    v1_steps = create.json()["blueprint"]["steps"]

    client.patch(f"/sessions/{session_id}/blueprint", json={"content": SAMPLE_BLUEPRINT})
    patched = client.get(f"/sessions/{session_id}")
    assert patched.json()["active_version"] == 2

    restored = client.post(f"/sessions/{session_id}/versions/1/restore")
    assert restored.status_code == 200
    body = restored.json()
    # Restoring creates version 3 — it never rewinds the pointer onto v1 in
    # place, so the fact a bad edit happened is never erased from history.
    assert body["active_version"] == 3
    assert body["blueprint"]["steps"] == v1_steps
    assert len(body["versions"]) == 3


@requires_postgres
def test_restore_nonexistent_version_returns_404(client) -> None:
    create = client.post("/sessions", json={"user_id": "restore-user-2", "title": "404 test"})
    session_id = create.json()["id"]

    res = client.post(f"/sessions/{session_id}/versions/999/restore")
    assert res.status_code == 404


@requires_postgres
def test_restore_version_from_a_different_session_is_not_found(client) -> None:
    """A version id is scoped to its own session — you cannot restore
    another session's version number onto this one, even if the version
    number happens to coincide."""
    a = client.post("/sessions", json={"user_id": "session-a", "title": "A"})
    b = client.post("/sessions", json={"user_id": "session-b", "title": "B"})
    session_a = a.json()["id"]
    session_b = b.json()["id"]
    # Give session A a second version so both sessions have a "version 2".
    client.patch(f"/sessions/{session_a}/blueprint", json={"content": SAMPLE_BLUEPRINT})

    # Session B only has version 1 — asking it to restore its own version 2
    # (which doesn't exist for B) must 404, not silently pull A's data.
    res = client.post(f"/sessions/{session_b}/versions/2/restore")
    assert res.status_code == 404
