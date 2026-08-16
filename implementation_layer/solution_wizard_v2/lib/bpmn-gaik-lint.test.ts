import { describe, expect, it } from "vitest";
import { lintGaikConventions } from "@/lib/bpmn-gaik-lint";

const WRAP = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    ${body}
  </bpmn:process>
</bpmn:definitions>`;

describe("lintGaikConventions (#64)", () => {
  it("warns on vague task names", async () => {
    const xml = WRAP(
      `<bpmn:startEvent id="start" />
       <bpmn:serviceTask id="t1" name="AI step" />
       <bpmn:endEvent id="end" />
       <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="t1" />
       <bpmn:sequenceFlow id="f2" sourceRef="t1" targetRef="end" />`,
    );
    const result = await lintGaikConventions(xml);
    expect(result.warnings.some((w) => w.rule === "gaik/task-name-verb-object")).toBe(
      true,
    );
  });

  it("warns when gateway is not a question", async () => {
    const xml = WRAP(
      `<bpmn:startEvent id="start" />
       <bpmn:exclusiveGateway id="g1" name="Check" />
       <bpmn:endEvent id="end" />
       <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="g1" />
       <bpmn:sequenceFlow id="f2" sourceRef="g1" targetRef="end" />`,
    );
    const result = await lintGaikConventions(xml);
    expect(result.warnings.some((w) => w.rule === "gaik/gateway-question")).toBe(true);
  });

  it("accepts verb-object task and question gateway", async () => {
    const xml = WRAP(
      `<bpmn:startEvent id="start" name="Started" />
       <bpmn:serviceTask id="t1" name="[STR] Transcribe Audio" />
       <bpmn:exclusiveGateway id="g1" name="Is quality acceptable?" />
       <bpmn:endEvent id="end" name="Done" />
       <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="t1" />
       <bpmn:sequenceFlow id="f2" sourceRef="t1" targetRef="g1" />
       <bpmn:sequenceFlow id="f3" sourceRef="g1" targetRef="end" />`,
    );
    const result = await lintGaikConventions(xml);
    expect(result.warnings).toEqual([]);
  });
});
