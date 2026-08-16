/**
 * GAIK / Dimitry modeling convention checks (#64).
 * Advisory warnings — official BPMN shapes only; naming conventions from GAIK guide.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type GaikLintIssue = {
  rule: string;
  id: string;
  message: string;
  category: "error" | "warn" | "info";
};

export type GaikLintResult = {
  ok: boolean;
  errors: GaikLintIssue[];
  warnings: GaikLintIssue[];
  issues: GaikLintIssue[];
};

const VAGUE_TASK =
  /^(ai\s*step|process\s*data|do\s*analysis|handle\s*document|check|decision|process|analyze|handle)$/i;

const TASK_TYPES = new Set([
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:Task",
  "bpmn:ManualTask",
  "bpmn:SendTask",
  "bpmn:CallActivity",
]);

type ModdleEl = {
  $type?: string;
  id?: string;
  name?: string;
  flowElements?: ModdleEl[];
  rootElements?: ModdleEl[];
};

function stripCodePrefix(name: string): string {
  return name.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function walk(el: ModdleEl | undefined, visit: (node: ModdleEl) => void): void {
  if (!el) return;
  visit(el);
  for (const child of el.flowElements ?? []) walk(child, visit);
  for (const child of el.rootElements ?? []) walk(child, visit);
}

export async function lintGaikConventions(xml: string): Promise<GaikLintResult> {
  const { BpmnModdle } = require("bpmn-moddle") as {
    BpmnModdle: new () => {
      fromXML: (xml: string) => Promise<{ rootElement: ModdleEl }>;
    };
  };
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);

  const issues: GaikLintIssue[] = [];
  const taskNames: string[] = [];
  const dataNodes: { id: string; name: string }[] = [];

  walk(rootElement, (node) => {
    const type = node.$type ?? "";
    const id = node.id ?? "";
    const name = (node.name ?? "").trim();

    if (TASK_TYPES.has(type)) {
      const plain = stripCodePrefix(name.split("\n")[0] ?? "");
      if (plain) taskNames.push(plain.toLowerCase());
      if (!plain) {
        issues.push({
          rule: "gaik/task-name-required",
          id,
          message: "Task should have a verb–object name",
          category: "warn",
        });
      } else if (VAGUE_TASK.test(plain)) {
        issues.push({
          rule: "gaik/task-name-verb-object",
          id,
          message: `Vague task name "${plain}" — use verb–object (e.g. Transcribe Audio)`,
          category: "warn",
        });
      }
    }

    if (type === "bpmn:ExclusiveGateway" || type === "bpmn:ParallelGateway") {
      if (name && !name.includes("?")) {
        issues.push({
          rule: "gaik/gateway-question",
          id,
          message: `Gateway label "${name}" should be a question (end with ?)`,
          category: "warn",
        });
      }
    }

    if (type === "bpmn:DataObjectReference" && name) {
      dataNodes.push({ id, name });
    }
  });

  const taskSet = new Set(taskNames);
  for (const d of dataNodes) {
    if (taskSet.has(d.name.toLowerCase())) {
      issues.push({
        rule: "gaik/data-object-not-task-title",
        id: d.id,
        message: `Data object "${d.name}" matches a task title — name the data (Audio, Transcript, …)`,
        category: "warn",
      });
    }
  }

  const errors = issues.filter((i) => i.category === "error");
  const warnings = issues.filter((i) => i.category === "warn" || i.category === "info");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
