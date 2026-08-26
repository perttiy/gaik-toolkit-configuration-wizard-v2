import { describe, expect, it } from "vitest";
import { lintBpmnXml } from "@/lib/bpmn-lint";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const BAD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false" />
</bpmn:definitions>`;

function generatedWizardXml(): string {
  const swSrc = resolve(__dirname, "../../solution_wizard/src");
  const implSrc = resolve(__dirname, "../../src");
  const script = `
from solution_wizard.v2_adapter import v2_to_v1_dict
from solution_wizard.bpmn_generator import generate_bpmn
from solution_wizard.blueprint import Blueprint
v2 = {"name":"Demo","description":"","goal":"","steps":[
 {"id":"a","name":"Upload","type":"io"},
 {"id":"b","name":"Extract","type":"ai","component":"DataExtractor"},
]}
print(generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="t"))))
`;
  return execFileSync("python3", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: [swSrc, implSrc, process.env.PYTHONPATH ?? ""].join(":"),
    },
  });
}

describe("lintBpmnXml (#47)", () => {
  it("blocks incomplete process with errors", async () => {
    const result = await lintBpmnXml(BAD_XML);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.rule.includes("start-event"))).toBe(true);
  });

  it("accepts wizard-generated BPMN (recommended rules)", async () => {
    const xml = generatedWizardXml();
    const result = await lintBpmnXml(xml);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags GAIK convention violations as warnings, not errors (S3-2)", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Activity_1" name="Process data">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_1" name="Looks fine">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:dataObjectReference id="DataObjectRef_1" name="Extract Fields" dataObjectRef="DataObject_1" />
    <bpmn:dataObject id="DataObject_1" />
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Activity_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Activity_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Gateway_1" targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;
    const result = await lintBpmnXml(xml);
    const gaikWarnings = result.warnings.filter((w) => w.rule.startsWith("gaik/"));
    expect(gaikWarnings.map((w) => w.rule).sort()).toEqual([
      "gaik/data-object-is-data",
      "gaik/gateway-question-form",
      "gaik/vague-task-names",
    ]);
    // GAIK rules never appear in errors — they're warn-first (S3-2 scope).
    expect(result.errors.some((e) => e.rule.startsWith("gaik/"))).toBe(false);
  });

  it("wizard-generated BPMN also passes the GAIK rules (S3-2)", async () => {
    const xml = generatedWizardXml();
    const result = await lintBpmnXml(xml);
    const gaikWarnings = result.warnings.filter((w) => w.rule.startsWith("gaik/"));
    expect(gaikWarnings).toEqual([]);
  });

  it("lints a customer reference BPMN without crashing", async () => {
    // Customer BPMN lives under gitignored docs/6.7_demo/ — skip in CI/clean clones.
    const ref = resolve(
      __dirname,
      "../docs/6.7_demo/extracted/Use_Case_Audio-to-Structured.bpmn",
    );
    if (!existsSync(ref)) {
      return;
    }
    const xml = readFileSync(ref, "utf8");
    const result = await lintBpmnXml(xml);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.ok).toBe("boolean");
  });
});
