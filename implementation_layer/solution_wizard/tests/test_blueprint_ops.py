"""Tests for V2 blueprint change-ops (#66 / #68)."""

from __future__ import annotations

import pytest

from solution_wizard.blueprint import Blueprint
from solution_wizard.blueprint_ops import ChangeOpError, apply_change_ops, derive_change_ops
from solution_wizard.bpmn_generator import generate_bpmn
from solution_wizard.bpmn_sync import sync_v2_blueprint_from_bpmn_xml
from solution_wizard.v2_adapter import v2_to_v1_dict


def _base() -> dict:
    return {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Syöte", "type": "io"},
            {"id": "ai", "name": "Generointi", "type": "ai", "component": "LLM"},
            {"id": "out", "name": "Vastaus", "type": "io"},
        ],
    }


def test_rename_and_reorder_ops():
    bp = apply_change_ops(
        _base(),
        [
            {"op": "rename_step", "step_id": "ai", "name": "Extract Data"},
            {"op": "reorder_steps", "step_ids": ["ai", "input", "out"]},
        ],
    )
    assert [s["id"] for s in bp["steps"]] == ["ai", "input", "out"]
    assert bp["steps"][0]["name"] == "Extract Data"


def test_set_data_object_and_gateway_ops():
    bp = apply_change_ops(
        _base(),
        [
            {"op": "set_data_object", "artifact_id": "sy_te", "label": "Audio Clip"},
            {
                "op": "set_gateways",
                "gateways": [
                    {
                        "id": "Gateway_approve_rev",
                        "name": "Quality OK?",
                        "type": "exclusive",
                        "outgoing": [{"id": "f1", "targetRef": "End", "name": "Yes"}],
                    }
                ],
            },
        ],
    )
    assert bp["data_objects"]["sy_te"] == "Audio Clip"
    assert bp["gateways"][0]["name"] == "Quality OK?"
    assert bp["gateways"][0]["outgoing"][0]["name"] == "Yes"


def test_invalid_op_raises():
    with pytest.raises(ChangeOpError):
        apply_change_ops(_base(), [{"op": "nope"}])


def test_canvas_sync_returns_ops_and_gateway_outgoing():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload", "type": "io"},
            {"id": "rev", "name": "Review", "type": "human_review"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    synced, ops = sync_v2_blueprint_from_bpmn_xml(v2, xml, return_ops=True)
    assert isinstance(ops, list)
    assert synced.get("gateways")
    gw = next(g for g in synced["gateways"] if g.get("name") == "Approved?")
    assert "outgoing" in gw
    assert isinstance(gw["outgoing"], list)


def test_data_object_label_survives_regenerate():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Syöte", "type": "io"},
            {"id": "ai", "name": "Generointi", "type": "ai"},
        ],
        # Real synthesized artifact id for the first (io-type) step is
        # "user_input" (see _synthesize_artifacts_and_links) — not derived
        # from the step's own name/id, so the override key must match that,
        # not "sy_te" (a guess from an earlier artifact-naming scheme).
        "data_objects": {"user_input": "Voice Note"},
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    assert 'name="Voice Note"' in xml


def test_gateway_name_override_survives_regenerate():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload", "type": "io"},
            {"id": "rev", "name": "Review", "type": "human_review"},
        ],
        "gateways": [
            {
                "id": "Gateway_approve_rev",
                "name": "Is quality acceptable?",
                "type": "exclusive",
                "outgoing": [],
            }
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    assert "Is quality acceptable?" in xml


def test_derive_change_ops_round_trip():
    before = _base()
    after = apply_change_ops(
        before,
        [{"op": "rename_step", "step_id": "input", "name": "Audio Input"}],
    )
    ops = derive_change_ops(before, after)
    rebuilt = apply_change_ops(before, ops)
    assert rebuilt["steps"][0]["name"] == "Audio Input"
