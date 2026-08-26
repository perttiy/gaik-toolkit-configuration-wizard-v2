"""Tests for V2 blueprint adapter and BPMN sync."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from solution_wizard.blueprint import Blueprint
from solution_wizard.bpmn_generator import generate_bpmn
from solution_wizard.bpmn_sync import sync_v2_blueprint_from_bpmn_xml
from solution_wizard.v2_adapter import v2_to_v1_dict


def _sample_v2():
    return {
        "name": "Chatbot",
        "description": "Test",
        "goal": "Automate",
        "steps": [
            {"id": "input", "name": "User question", "type": "io", "description": "Ask"},
            {"id": "rag", "name": "RAG search", "type": "ai", "component": "pgvector"},
            {"id": "review", "name": "Human review", "type": "human_review"},
        ],
    }


def test_v2_to_v1_minimal_blueprint():
    v2 = _sample_v2()
    v1 = v2_to_v1_dict(v2, session_id="ses_test")
    bp = Blueprint.model_validate(v1)
    assert bp.use_case.name == "Chatbot"
    assert len(bp.workflow.steps) == 3
    assert bp.workflow.steps[0].type == "user_task"
    assert bp.workflow.steps[1].type == "automated_task"
    assert bp.artifacts  # synthesized data objects
    assert "pgvector" in bp.components.selected_building_blocks
    xml = generate_bpmn(bp)
    assert "<bpmn:definitions" in xml
    assert "User question" in xml
    # Official conventions: no custom caption suffixes; GenAI lane; descriptive events
    assert "[User input]" not in xml
    assert "GenAI" in xml
    assert "Started Chatbot" in xml
    assert "Chatbot completed" in xml
    assert "dataObjectReference" in xml


def test_v2_automated_task_uses_component_code_prefix():
    v2 = {
        "name": "Extract",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload document", "type": "io"},
            {
                "id": "ex",
                "name": "Extract Structured Data",
                "type": "ai",
                "component": "DataExtractor",
            },
        ],
    }
    bp = Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s"))
    xml = generate_bpmn(bp)
    assert "[SE] Extract Structured Data" in xml
    assert "Upload document" in xml
    assert "[User input]" not in xml


def test_sync_updates_step_names_from_bpmn():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Old name", "type": "io"},
            {"id": "ai", "name": "AI step", "type": "ai"},
        ],
    }
    v1 = v2_to_v1_dict(v2, session_id="s1")
    xml = generate_bpmn(Blueprint.model_validate(v1))
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml.replace("Old name", "New label"))
    ids = [s["id"] for s in synced["steps"]]
    names = [s["name"] for s in synced["steps"]]
    assert ids == ["input", "ai"]
    assert "New label" in names
    assert len(synced["steps"]) == 2


def test_sync_removes_deleted_steps_and_keeps_order():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "a", "name": "First", "type": "io"},
            {"id": "b", "name": "Middle", "type": "ai"},
            {"id": "c", "name": "Last", "type": "io"},
        ],
    }
    # Canvas with only a and c (b deleted): linear graph Start→a→c→End
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://gaik.solutionwizard/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Started" />
    <bpmn:userTask id="Activity_a" name="First" />
    <bpmn:userTask id="Activity_c" name="Last" />
    <bpmn:endEvent id="EndEvent_success" name="Done" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Activity_a" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Activity_a" targetRef="Activity_c" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Activity_c" targetRef="EndEvent_success" />
  </bpmn:process>
</bpmn:definitions>
"""
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml)
    ids = [s["id"] for s in synced["steps"]]
    assert ids == ["a", "c"]
    assert synced["steps"][0]["type"] == "io"
    assert synced["steps"][1]["type"] == "io"


def test_sync_strips_component_code_prefix():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload", "type": "io"},
            {"id": "ex", "name": "Extract", "type": "ai", "component": "DataExtractor"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml)
    by_id = {s["id"]: s for s in synced["steps"]}
    assert by_id["ex"]["name"] == "Extract"
    assert by_id["ex"]["type"] == "ai"


def test_data_objects_use_human_readable_labels():
    """Data objects are data names (guide), not copies of task titles."""
    v2 = _sample_v2()
    bp = Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s"))
    xml = generate_bpmn(bp)
    assert 'DataObjectRef_user_input" name="User Input"' in xml
    assert 'DataObjectRef_search_result" name="Search Result"' in xml
    assert 'DataObjectRef_reviewed_output" name="Reviewed Output"' in xml
    # Task titles may still appear on activities; data refs must stay data-named
    assert "DataObjectRef_" in xml
    assert not any(
        f'DataObjectRef_{slug}" name="{title}"' in xml
        for slug, title in (
            ("user_question", "User Question"),
            ("rag_search", "Rag Search"),
            ("human_review", "Human Review"),
        )
    )


def test_v2_integration_targets_emit_bpmn_data_store():
    """V2 ``integration_targets`` → V1 generator dataStoreReference + send task."""
    v2 = {
        **_sample_v2(),
        "integration_targets": ["incident_reporting_database"],
    }
    v1 = v2_to_v1_dict(v2, session_id="s")
    assert v1["technical_spec"]["integration_targets"] == ["incident_reporting_database"]
    xml = generate_bpmn(Blueprint.model_validate(v1))
    assert "dataStoreReference" in xml
    assert "Incident Reporting Database" in xml
    assert "Submit to" in xml


def test_v2_data_stores_alias_maps_to_integration_targets():
    v2 = {
        **_sample_v2(),
        "data_stores": ["erp_system"],
    }
    v1 = v2_to_v1_dict(v2, session_id="s")
    assert v1["technical_spec"]["integration_targets"] == ["erp_system"]
    xml = generate_bpmn(Blueprint.model_validate(v1))
    assert "dataStoreReference" in xml
    assert "Erp System" in xml


def test_v2_without_integration_targets_has_no_data_store():
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(_sample_v2(), session_id="s")))
    assert "dataStoreReference" not in xml


def test_data_objects_for_audio_pipeline_follow_guide():
    v2 = {
        "name": "Incident reporting",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "record", "name": "Record Voice Description", "type": "io"},
            {
                "id": "transcribe",
                "name": "Transcribe Audio",
                "type": "ai",
                "component": "WhisperTranscriber",
            },
            {
                "id": "extract",
                "name": "Extract Structured Data",
                "type": "ai",
                "component": "DataExtractor",
            },
            {"id": "review", "name": "Review Report", "type": "human_review"},
        ],
    }
    bp = Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s"))
    xml = generate_bpmn(bp)
    assert 'name="Voice Note Audio"' in xml
    assert 'name="Raw Transcript"' in xml
    assert 'name="Structured JSON"' in xml
    assert 'name="Reviewed Output"' in xml
    assert "[STR] Transcribe Audio" in xml
    assert "[SE] Extract Structured Data" in xml
    assert "Business User" in xml and "GenAI" in xml and "Reviewer" in xml


def test_lowercase_component_alias_gets_official_code():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload audio", "type": "io"},
            {"id": "tr", "name": "Transcribe Audio", "type": "ai", "component": "transcriber"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    assert "[STR] Transcribe Audio" in xml


def test_sync_preserves_non_ascii_step_names_on_round_trip():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Syöte4", "type": "io"},
            {"id": "ai", "name": "Generointi", "type": "ai"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml)
    by_id = {s["id"]: s for s in synced["steps"]}
    assert by_id["input"]["name"] == "Syöte4"


def test_sync_updates_step_name_from_task_rename_with_non_ascii():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Syöte4", "type": "io"},
            {"id": "ai", "name": "Generointi", "type": "ai"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    edited = xml.replace('name="Syöte4"', 'name="Syöte5"', 1)
    synced = sync_v2_blueprint_from_bpmn_xml(v2, edited)
    by_id = {s["id"]: s for s in synced["steps"]}
    assert by_id["input"]["name"] == "Syöte5"


def test_sync_updates_step_name_when_data_object_is_renamed():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Syöte", "type": "io"},
            {"id": "ai", "name": "Generointi", "type": "ai"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    # First io step synthesizes user_input → "User Input"
    assert 'id="DataObjectRef_user_input" name="User Input"' in xml
    edited = xml.replace(
        'id="DataObjectRef_user_input" name="User Input"',
        'id="DataObjectRef_user_input" name="Syöte1"',
    )
    synced = sync_v2_blueprint_from_bpmn_xml(v2, edited)
    by_id = {s["id"]: s for s in synced["steps"]}
    assert by_id["input"]["name"] == "Syöte1"
    assert synced["data_objects"]["user_input"] == "Syöte1"


def test_sync_snapshots_gateways():
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
    assert "exclusiveGateway" in xml
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml)
    assert synced.get("gateways")
    assert any(g.get("name") == "Approved?" for g in synced["gateways"])


# -- S3-1: gateway topology round-trip (branch/parallel-fork structure) -----


def _linear_v2():
    return {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "a", "name": "Collect", "type": "io"},
            {"id": "b", "name": "Classify", "type": "ai"},
            {"id": "c", "name": "Notify", "type": "ai"},
        ],
    }


def test_gateway_json_regenerates_exclusive_branch_topology():
    v2 = {
        **_linear_v2(),
        "gateways": [
            {
                "id": "Gateway_route",
                "name": "High risk?",
                "type": "exclusive",
                "after": "b",
                "outgoing": [
                    {"condition": "Yes", "target": "c"},
                    {"condition": "No", "target": "end"},
                ],
            }
        ],
    }
    v1 = v2_to_v1_dict(v2, session_id="s")
    dps = v1["business_process"]["decision_points"]
    assert len(dps) == 1
    assert dps[0]["after"] == "b"
    assert dps[0]["type"] == "exclusive"
    assert len(dps[0]["branches"]) == 2

    xml = generate_bpmn(Blueprint.model_validate(v1))
    assert 'id="Gateway_decision_Gateway_route"' in xml
    assert 'name="High risk?"' in xml
    # Exactly the two authored branches leave the gateway — no leftover/duplicate
    # edge from the pre-branch linear chain (b -> c) alongside them.
    assert xml.count('sourceRef="Gateway_decision_Gateway_route"') == 2
    assert 'sourceRef="Gateway_decision_Gateway_route" targetRef="Activity_c"' in xml
    assert 'name="Yes" sourceRef="Gateway_decision_Gateway_route"' in xml
    assert 'name="No" sourceRef="Gateway_decision_Gateway_route"' in xml
    # The step the gateway follows now flows into the gateway, not straight to c.
    assert 'sourceRef="Activity_b" targetRef="Gateway_decision_Gateway_route"' in xml


def test_gateway_json_regenerates_parallel_fork():
    v2 = {
        **_linear_v2(),
        "gateways": [
            {
                "id": "Gateway_fork",
                "name": "Fan out",
                "type": "parallel",
                "after": "a",
                "outgoing": [
                    {"condition": "", "target": "b"},
                    {"condition": "", "target": "c"},
                ],
            }
        ],
    }
    v1 = v2_to_v1_dict(v2, session_id="s")
    assert v1["business_process"]["decision_points"][0]["type"] == "parallel"
    xml = generate_bpmn(Blueprint.model_validate(v1))
    assert 'bpmn:parallelGateway id="Gateway_decision_Gateway_fork"' in xml
    assert xml.count('sourceRef="Gateway_decision_Gateway_fork"') == 2


def test_gateway_without_topology_is_ignored():
    """A gateway snapshot missing `after` or `outgoing` (e.g. best-effort sync
    couldn't resolve it) must not produce a broken/empty decision point."""
    v2 = {
        **_linear_v2(),
        "gateways": [{"id": "Gateway_orphan", "name": "?", "type": "exclusive"}],
    }
    v1 = v2_to_v1_dict(v2, session_id="s")
    assert v1["business_process"]["decision_points"] == []


def test_approval_gateway_not_duplicated_as_decision_point():
    """A synced canvas snapshot naturally includes the auto-derived approval
    gateway too (it's a real exclusiveGateway on the canvas) — it must not also
    become a decision point, or the review step would render two gateways."""
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
                "name": "Approved?",
                "type": "exclusive",
                "after": "rev",
                "outgoing": [{"condition": "Yes", "target": "end"}],
            }
        ],
    }
    v1 = v2_to_v1_dict(v2, session_id="s")
    assert v1["business_process"]["decision_points"] == []
    xml = generate_bpmn(Blueprint.model_validate(v1))
    # only the one gateway element from _enrich_approval (open-tag count, since a
    # gateway with children renders as a tag pair, not self-closing)
    assert xml.count('<bpmn:exclusiveGateway id="') == 1


def test_full_canvas_round_trip_preserves_gateway_topology():
    """End-to-end: generate → hand-edit the canvas XML to add a real branching
    gateway → sync back to V2 JSON → regenerate — the branch survives."""
    v2 = _linear_v2()
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    # Splice in an exclusive gateway between Classify (b) and Notify (c): the
    # generator's linear chain already has `sourceRef="Activity_b"
    # targetRef="Activity_c"` — replace that one flow with a small gateway
    # fragment carrying two branches, as if drawn on the canvas.
    original_flow = None
    for line in xml.splitlines():
        if 'sourceRef="Activity_b"' in line and 'targetRef="Activity_c"' in line:
            original_flow = line.strip()
            break
    assert original_flow is not None
    edited = xml.replace(
        original_flow,
        '<bpmn:exclusiveGateway id="Gateway_route" name="High risk?" />'
        '<bpmn:sequenceFlow id="Flow_gw_in" sourceRef="Activity_b" targetRef="Gateway_route" />'
        '<bpmn:sequenceFlow id="Flow_gw_yes" name="Yes" sourceRef="Gateway_route" '
        'targetRef="Activity_c" />'
        '<bpmn:sequenceFlow id="Flow_gw_no" name="No" sourceRef="Gateway_route" '
        'targetRef="EndEvent_success" />',
    )
    synced = sync_v2_blueprint_from_bpmn_xml(v2, edited)
    gw = next(g for g in synced["gateways"] if g["id"] == "Gateway_route")
    assert gw["after"] == "b"
    assert {(b["condition"], b["target"]) for b in gw["outgoing"]} == {
        ("Yes", "c"),
        ("No", "end"),
    }

    v1_again = v2_to_v1_dict(synced, session_id="s")
    regenerated = generate_bpmn(Blueprint.model_validate(v1_again))
    assert regenerated.count('sourceRef="Gateway_decision_Gateway_route"') == 2
