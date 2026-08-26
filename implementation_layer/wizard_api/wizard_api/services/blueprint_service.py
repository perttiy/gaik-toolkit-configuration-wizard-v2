import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from wizard_api.models import BlueprintVersion, WizardSession

try:
    from solution_wizard.blueprint_ops import ChangeOpError, apply_change_ops

    _BLUEPRINT_OPS_AVAILABLE = True
except ImportError:  # pragma: no cover - optional in minimal installs
    _BLUEPRINT_OPS_AVAILABLE = False


class BlueprintOpsError(RuntimeError):
    """Change-ops unavailable or the op list itself was invalid."""


def default_blueprint_content(title: str) -> dict:
    """Dummy blueprint so new sessions have editable BPMN/JSON before schema design."""
    name = title.strip() or "Nimetön sessio"
    return {
        "name": name,
        "description": (
            "Placeholder blueprint until schema design — replace with the agreed output fields."
        ),
        "goal": "Draft flow so BPMN and JSON are editable from the first session.",
        "steps": [
            {
                "id": "input",
                "name": "Input",
                "type": "io",
                "description": "User or system input (placeholder)",
            },
            {
                "id": "process",
                "name": "Process",
                "type": "ai",
                "component": "LLM",
                "description": "Core GenAI step (placeholder)",
            },
            {
                "id": "review",
                "name": "Human review",
                "type": "human_review",
                "description": "Optional check before output (placeholder)",
            },
            {
                "id": "output",
                "name": "Output",
                "type": "io",
                "description": "Returned result (placeholder)",
            },
        ],
    }


def create_initial_version(
    db: Session,
    session: WizardSession,
    *,
    title: str,
    note: str = "Alustava blueprint",
) -> BlueprintVersion:
    version = BlueprintVersion(
        session_id=session.id,
        version=1,
        note=note,
        content=default_blueprint_content(title),
    )
    db.add(version)
    session.active_version = 1
    return version


def add_version(
    db: Session,
    session: WizardSession,
    *,
    note: str,
    content: dict | None = None,
) -> BlueprintVersion:
    latest = get_latest_version(db, session.id)
    next_version = 1 if latest is None else latest.version + 1
    body = (
        content
        if content is not None
        else (latest.content if latest else default_blueprint_content(""))
    )
    version = BlueprintVersion(
        session_id=session.id,
        version=next_version,
        note=note,
        content=body,
    )
    db.add(version)
    session.active_version = next_version
    return version


def list_versions(db: Session, session_id: uuid.UUID) -> list[BlueprintVersion]:
    stmt = (
        select(BlueprintVersion)
        .where(BlueprintVersion.session_id == session_id)
        .order_by(BlueprintVersion.version.asc())
    )
    return list(db.scalars(stmt).all())


def get_latest_version(db: Session, session_id: uuid.UUID) -> BlueprintVersion | None:
    stmt = (
        select(BlueprintVersion)
        .where(BlueprintVersion.session_id == session_id)
        .order_by(BlueprintVersion.version.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def get_active_version(db: Session, session: WizardSession) -> BlueprintVersion | None:
    stmt = select(BlueprintVersion).where(
        BlueprintVersion.session_id == session.id,
        BlueprintVersion.version == session.active_version,
    )
    return db.scalars(stmt).first()


def get_version(db: Session, session_id: uuid.UUID, version: int) -> BlueprintVersion | None:
    stmt = select(BlueprintVersion).where(
        BlueprintVersion.session_id == session_id,
        BlueprintVersion.version == version,
    )
    return db.scalars(stmt).first()


def apply_ops(
    db: Session,
    session: WizardSession,
    *,
    ops: list[dict],
    note: str = "Blueprint change-ops",
) -> BlueprintVersion:
    """Apply structured change-ops (S3-4/#66) to the active blueprint and
    create a new version from the result. JSON stays source of truth — the
    caller (BPMN sync route) is responsible for regenerating BPMN from the
    returned content afterward, same as any other add_version() call."""
    if not _BLUEPRINT_OPS_AVAILABLE:
        raise BlueprintOpsError("solution_wizard.blueprint_ops is not installed")
    active = get_active_version(db, session)
    current = active.content if active else default_blueprint_content("")
    try:
        updated = apply_change_ops(current, ops)
    except ChangeOpError as exc:
        raise BlueprintOpsError(str(exc)) from exc
    return add_version(db, session, note=note, content=updated)


def restore_version(
    db: Session,
    session: WizardSession,
    *,
    version: int,
) -> BlueprintVersion:
    """Undo/restore (S3-5/#67): copy an earlier version's content forward as
    a brand-new version. Never rewinds session.active_version onto the old
    row in place — that would destroy the fact that the bad edit ever
    happened. Restoring is itself just another tracked, auditable version."""
    target = get_version(db, session.id, version)
    if target is None:
        raise BlueprintOpsError(f"version {version} does not exist for this session")
    return add_version(
        db,
        session,
        note=f"Restored version {version}",
        content=dict(target.content),
    )
