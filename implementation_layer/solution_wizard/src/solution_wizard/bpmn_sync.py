"""Sync BPMN 2.0 XML canvas edits back into V2 simplified blueprint steps."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
TASK_TAGS = {
    f"{{{BPMN_NS}}}userTask",
    f"{{{BPMN_NS}}}serviceTask",
    f"{{{BPMN_NS}}}task",
    f"{{{BPMN_NS}}}manualTask",
    f"{{{BPMN_NS}}}sendTask",
    f"{{{BPMN_NS}}}callActivity",
}
# Synthetic generator tasks that should not become blueprint steps.
_SYNTHETIC_PREFIXES = (
    "Activity_submit_",
    "Activity_generate_pdf",
)


def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _task_label(raw: str) -> str:
    """Strip optional ``[CODE]`` prefix / legacy caption suffixes from task names."""
    text = (raw or "").strip()
    if not text:
        return ""
    first = text.split("\n")[0].strip()
    # Legacy: "Name\n[Component]" or trailing " [Component]"
    first = re.sub(r"\s*\[[^\]]+\]\s*$", "", first).strip()
    # Official implementation style: "[STR] Transcribe Audio"
    first = re.sub(r"^\[[^\]]+\]\s*", "", first).strip()
    return first or text.split("\n")[0].strip()


def _documentation_text(el: ET.Element) -> str:
    for child in el:
        if _local(child.tag) == "documentation" and (child.text or "").strip():
            return (child.text or "").strip()
    return ""


def _bpmn_id_to_step_id(bpmn_id: str) -> str:
    """Map generator activity ids back to blueprint step ids."""
    if bpmn_id.startswith("Activity_"):
        return bpmn_id[len("Activity_") :]
    if bpmn_id.startswith("Gateway_"):
        return bpmn_id[len("Gateway_") :]
    return bpmn_id


def _infer_v2_type(tag: str, bpmn_id: str, old_type: str | None) -> str:
    if old_type in ("io", "ai", "human_review"):
        # Preserve known types when the element still maps to an existing step.
        local = _local(tag)
        if local == "userTask" and old_type == "human_review":
            return "human_review"
        if local == "userTask" and old_type == "io":
            return "io"
        if local in ("serviceTask", "sendTask", "callActivity", "task") and old_type == "ai":
            return "ai"
    local = _local(tag)
    if local == "userTask":
        # Heuristic: review-ish ids/names stay human_review only via old_type;
        # new user tasks default to io.
        return "io"
    if local in ("serviceTask", "sendTask", "callActivity", "task", "manualTask"):
        return "ai"
    return old_type or "ai"


def _is_synthetic_task(bpmn_id: str) -> bool:
    return any(bpmn_id.startswith(p) for p in _SYNTHETIC_PREFIXES)


def _ordered_task_ids(root: ET.Element) -> list[str]:
    processes = [el for el in root.iter() if _local(el.tag) == "process"]
    if not processes:
        return []
    process = processes[0]

    nodes: dict[str, ET.Element] = {}
    for el in process.iter():
        if _local(el.tag) in {
            "startEvent",
            "endEvent",
            "userTask",
            "serviceTask",
            "task",
            "manualTask",
            "sendTask",
            "callActivity",
            "exclusiveGateway",
            "parallelGateway",
        }:
            if el.get("id"):
                nodes[el.get("id") or ""] = el

    outgoing: dict[str, list[str]] = {}
    for el in process.iter():
        if _local(el.tag) != "sequenceFlow":
            continue
        src = el.get("sourceRef")
        tgt = el.get("targetRef")
        if src and tgt:
            outgoing.setdefault(src, []).append(tgt)

    start_ids = [el.get("id") for el in process if _local(el.tag) == "startEvent" and el.get("id")]
    if not start_ids:
        return [
            el.get("id") or ""
            for el in process
            if el.tag in TASK_TAGS and el.get("id") and not _is_synthetic_task(el.get("id") or "")
        ]

    ordered: list[str] = []
    seen: set[str] = set()
    queue = list(start_ids)
    while queue:
        nid = queue.pop(0)
        if nid in seen or nid not in nodes:
            continue
        seen.add(nid)
        node = nodes[nid]
        if node.tag in TASK_TAGS and nid and not _is_synthetic_task(nid):
            ordered.append(nid)
        for tgt in outgoing.get(nid, []):
            if tgt not in seen:
                queue.append(tgt)

    return ordered


def _sync_data_object_names(root: ET.Element, v2_blueprint: dict[str, Any]) -> dict[str, str]:
    """Return artifact_id → label from BPMN dataObjectReference names (best-effort)."""
    mapping: dict[str, str] = {}
    for el in root.iter():
        if _local(el.tag) != "dataObjectReference":
            continue
        rid = el.get("id") or ""
        name = (el.get("name") or "").strip()
        if not rid or not name:
            continue
        # Generator ids: DataObjectRef_<artifact_id>
        if rid.startswith("DataObjectRef_"):
            art_id = rid[len("DataObjectRef_") :]
            mapping[art_id] = name.replace("\n", " ").strip()
    return mapping


def sync_v2_blueprint_from_bpmn_xml(
    v2_blueprint: dict[str, Any],
    bpmn_xml: str,
) -> dict[str, Any]:
    """Apply canvas edits to V2 blueprint steps.

    Supported:
    - rename tasks (strips ``[CODE]`` / legacy caption suffixes)
    - reorder steps from sequence-flow topology
    - add new tasks created on the canvas
    - remove steps whose activities were deleted from the canvas
    - sync ``bpmn:documentation`` → step.description when present
    - record data-object label edits under ``v2_blueprint[\"data_objects\"]``
    """
    root = ET.fromstring(bpmn_xml)
    processes = [el for el in root.iter() if _local(el.tag) == "process"]
    if not processes:
        return v2_blueprint

    process = processes[0]
    task_by_id: dict[str, ET.Element] = {}
    for el in process.iter():
        if el.tag in TASK_TAGS and el.get("id"):
            task_by_id[el.get("id") or ""] = el

    ordered_ids = _ordered_task_ids(root)
    if not ordered_ids:
        return v2_blueprint

    old_steps = list(v2_blueprint.get("steps") or [])
    old_by_id = {str(s.get("id")): s for s in old_steps if s.get("id")}

    new_steps: list[dict[str, Any]] = []
    seen_step_ids: set[str] = set()
    for tid in ordered_ids:
        task_el = task_by_id.get(tid)
        label = _task_label(task_el.get("name") if task_el is not None else "")
        docs = _documentation_text(task_el) if task_el is not None else ""
        step_id = _bpmn_id_to_step_id(tid)
        # Prefer exact blueprint id; fall back to Activity_-stripped id.
        old = old_by_id.get(step_id) or old_by_id.get(tid)
        resolved_id = str(old.get("id")) if old else step_id
        if resolved_id in seen_step_ids:
            continue
        seen_step_ids.add(resolved_id)

        if old:
            step = dict(old)
            if label:
                step["name"] = label
            if docs:
                step["description"] = docs
            elif task_el is not None and "description" in step and docs == "":
                # Keep existing description when BPMN has no documentation child.
                pass
            step["type"] = _infer_v2_type(
                task_el.tag if task_el is not None else "",
                tid,
                str(old.get("type") or "ai"),
            )
        else:
            step = {
                "id": resolved_id,
                "name": label or resolved_id,
                "type": _infer_v2_type(
                    task_el.tag if task_el is not None else "",
                    tid,
                    None,
                ),
                "description": docs or "Added from BPMN canvas",
            }
        new_steps.append(step)

    updated = dict(v2_blueprint)
    updated["steps"] = new_steps

    data_labels = _sync_data_object_names(root, v2_blueprint)
    if data_labels:
        updated["data_objects"] = {
            **dict(v2_blueprint.get("data_objects") or {}),
            **data_labels,
        }

    return updated
