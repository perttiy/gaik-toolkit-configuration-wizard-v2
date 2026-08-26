"""Structured change-ops for V2 blueprint JSON (JSON = source of truth).

Canvas sync and chat tools should converge on these ops instead of patching
raw BPMN XML as the authority.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


class ChangeOpError(ValueError):
    """Invalid or unsupported change operation."""


SUPPORTED_OPS = frozenset(
    {
        "rename_step",
        "reorder_steps",
        "upsert_step",
        "remove_step",
        "set_data_object",
        "set_gateway",
        "set_gateways",
        "replace_steps",
    }
)


def apply_change_ops(
    blueprint: dict[str, Any],
    ops: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply a list of change-ops to a V2 blueprint; return a new dict."""
    if not isinstance(ops, list):
        raise ChangeOpError("ops must be a list")
    out = deepcopy(blueprint)
    for i, op in enumerate(ops):
        if not isinstance(op, dict):
            raise ChangeOpError(f"op[{i}] must be an object")
        op_type = str(op.get("op") or "").strip()
        if op_type not in SUPPORTED_OPS:
            raise ChangeOpError(f"op[{i}]: unsupported op {op_type!r}")
        _apply_one(out, op_type, op, i)
    return out


def _apply_one(bp: dict[str, Any], op_type: str, op: dict[str, Any], index: int) -> None:
    if op_type == "rename_step":
        step_id = str(op.get("step_id") or "")
        name = op.get("name")
        if not step_id or not isinstance(name, str) or not name.strip():
            raise ChangeOpError(f"op[{index}]: rename_step requires step_id and name")
        steps = list(bp.get("steps") or [])
        found = False
        for step in steps:
            if str(step.get("id")) == step_id:
                step["name"] = name.strip()
                found = True
                break
        if not found:
            raise ChangeOpError(f"op[{index}]: unknown step_id {step_id!r}")
        bp["steps"] = steps
        return

    if op_type == "reorder_steps":
        order = op.get("step_ids")
        if not isinstance(order, list) or not order:
            raise ChangeOpError(f"op[{index}]: reorder_steps requires step_ids")
        by_id = {str(s.get("id")): s for s in list(bp.get("steps") or []) if s.get("id")}
        new_steps: list[dict[str, Any]] = []
        seen: set[str] = set()
        for sid in order:
            key = str(sid)
            if key not in by_id:
                raise ChangeOpError(f"op[{index}]: unknown step_id {key!r}")
            if key in seen:
                continue
            seen.add(key)
            new_steps.append(dict(by_id[key]))
        # Append any steps not listed (preserve rather than drop silently).
        for sid, step in by_id.items():
            if sid not in seen:
                new_steps.append(dict(step))
        bp["steps"] = new_steps
        return

    if op_type == "upsert_step":
        step = op.get("step")
        if not isinstance(step, dict) or not step.get("id"):
            raise ChangeOpError(f"op[{index}]: upsert_step requires step with id")
        sid = str(step["id"])
        steps = list(bp.get("steps") or [])
        replaced = False
        for i, existing in enumerate(steps):
            if str(existing.get("id")) == sid:
                merged = dict(existing)
                merged.update(step)
                steps[i] = merged
                replaced = True
                break
        if not replaced:
            steps.append(dict(step))
        bp["steps"] = steps
        return

    if op_type == "remove_step":
        step_id = str(op.get("step_id") or "")
        if not step_id:
            raise ChangeOpError(f"op[{index}]: remove_step requires step_id")
        bp["steps"] = [s for s in list(bp.get("steps") or []) if str(s.get("id")) != step_id]
        return

    if op_type == "set_data_object":
        artifact_id = str(op.get("artifact_id") or "")
        label = op.get("label")
        if not artifact_id or not isinstance(label, str) or not label.strip():
            raise ChangeOpError(f"op[{index}]: set_data_object requires artifact_id and label")
        data = dict(bp.get("data_objects") or {})
        data[artifact_id] = label.strip()
        bp["data_objects"] = data
        return

    if op_type == "set_gateway":
        gateway = op.get("gateway")
        if not isinstance(gateway, dict) or not gateway.get("id"):
            raise ChangeOpError(f"op[{index}]: set_gateway requires gateway with id")
        gateways = list(bp.get("gateways") or [])
        gid = str(gateway["id"])
        replaced = False
        for i, existing in enumerate(gateways):
            if str(existing.get("id")) == gid:
                merged = dict(existing)
                merged.update(gateway)
                gateways[i] = merged
                replaced = True
                break
        if not replaced:
            gateways.append(dict(gateway))
        bp["gateways"] = gateways
        return

    if op_type == "set_gateways":
        gateways = op.get("gateways")
        if not isinstance(gateways, list):
            raise ChangeOpError(f"op[{index}]: set_gateways requires gateways list")
        bp["gateways"] = [dict(g) for g in gateways if isinstance(g, dict) and g.get("id")]
        return

    if op_type == "replace_steps":
        steps = op.get("steps")
        if not isinstance(steps, list):
            raise ChangeOpError(f"op[{index}]: replace_steps requires steps list")
        bp["steps"] = [dict(s) for s in steps if isinstance(s, dict) and s.get("id")]
        return


def derive_change_ops(
    before: dict[str, Any],
    after: dict[str, Any],
) -> list[dict[str, Any]]:
    """Derive a minimal op list that transforms ``before`` into ``after`` (V2)."""
    ops: list[dict[str, Any]] = []
    before_steps = list(before.get("steps") or [])
    after_steps = list(after.get("steps") or [])
    before_ids = [str(s.get("id")) for s in before_steps if s.get("id")]
    after_ids = [str(s.get("id")) for s in after_steps if s.get("id")]
    before_by_id = {str(s.get("id")): s for s in before_steps if s.get("id")}
    after_by_id = {str(s.get("id")): s for s in after_steps if s.get("id")}

    removed = [sid for sid in before_ids if sid not in after_by_id]
    for sid in removed:
        ops.append({"op": "remove_step", "step_id": sid})

    for sid in after_ids:
        if sid not in before_by_id:
            ops.append({"op": "upsert_step", "step": dict(after_by_id[sid])})
        else:
            old = before_by_id[sid]
            new = after_by_id[sid]
            if str(old.get("name") or "") != str(new.get("name") or ""):
                ops.append(
                    {"op": "rename_step", "step_id": sid, "name": str(new.get("name") or "")}
                )
            # Other field drifts → upsert
            keys = ("type", "description", "component")
            if any(old.get(k) != new.get(k) for k in keys):
                ops.append({"op": "upsert_step", "step": dict(new)})

    if after_ids and after_ids != [sid for sid in before_ids if sid in after_by_id]:
        ops.append({"op": "reorder_steps", "step_ids": after_ids})

    before_do = dict(before.get("data_objects") or {})
    after_do = dict(after.get("data_objects") or {})
    for art_id, label in after_do.items():
        if before_do.get(art_id) != label:
            ops.append({"op": "set_data_object", "artifact_id": art_id, "label": label})

    before_gw = list(before.get("gateways") or [])
    after_gw = list(after.get("gateways") or [])
    if after_gw != before_gw:
        ops.append({"op": "set_gateways", "gateways": after_gw})

    return ops
