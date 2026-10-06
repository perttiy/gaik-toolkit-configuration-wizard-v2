/**
 * The generated solution as a process (cases): roles, screens and the review
 * form, all derived from what the wizard already produced. The BPMN gives the
 * roles (lanes holding a user task), the order of the steps and the review
 * decision; `target_output_spec` gives the form. Nothing here is written for
 * one use case.
 */

export type ProcessLane = { id: string; name: string; human: boolean };
export type ProcessNode = {
  id: string;
  kind: string;
  name: string;
  lane: string | null;
  inputs: (string | null)[];
  outputs: (string | null)[];
};
export type ProcessFlow = { from: string; to: string; name: string };
export type Process = { lanes: ProcessLane[]; nodes: ProcessNode[]; flows: ProcessFlow[] };

/** `target_output_spec` as wizard_api serves it (snake_case, V1 shape). */
export type OutputSpec = {
  schema_name?: string;
  fields: string[];
  field_types?: Record<string, string>;
  required_fields?: string[];
  field_descriptions?: Record<string, string>;
  allowed_values?: Record<string, string[]>;
};

export type CaseModel = {
  title: string;
  spec: OutputSpec;
  process: Process;
  package_ready: boolean;
  package_problems: string[];
};

export type CaseStatus =
  | "draft"
  | "running"
  | "review"
  | "returned"
  | "approved"
  | "rejected"
  | "failed";

export type CaseRecord = Record<string, unknown>;

export type Case = {
  id: string;
  created_at: string;
  status: CaseStatus;
  round: number;
  note: string;
  comment: string;
  run_id: string | null;
  run_phase?: string;
  run_message: string | null;
  inputs: { name: string; bytes: number }[];
  result: {
    record: CaseRecord | null;
    validation: { passed?: boolean } | null;
    transcript: string;
    document?: string;
    files: string[];
  } | null;
  record: CaseRecord | null;
  events: { at: string; role: string; action: string; detail: string }[];
};

const YES = /^(yes|kyllä|approved?|hyväksytty)$/i;

export const isHumanTask = (n?: ProcessNode) =>
  !!n && (n.kind === "userTask" || n.kind === "manualTask");
export const isTask = (n?: ProcessNode) => !!n && /Task$|^task$/.test(n.kind);

/**
 * The parts of the process the UI needs: the steps in order (following the
 * approve branch at a gateway), the first user task (who gives the input), the
 * review task after it, and the roles.
 */
export function shapeProcess(process: Process) {
  const byId = new Map(process.nodes.map((n) => [n.id, n]));
  const out = (id: string) => process.flows.filter((f) => f.from === id);
  const start = process.nodes.find((n) => n.kind === "startEvent");
  const steps: ProcessNode[] = [];
  const seen = new Set<string>();
  let id = start?.id;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = byId.get(id);
    if (isTask(node)) steps.push(node as ProcessNode);
    const next = out(id);
    id = (next.find((f) => YES.test(f.name)) ?? next[0])?.to;
  }
  const inputTask = steps.find(isHumanTask);
  const reviewTask = steps.find((n) => isHumanTask(n) && n !== inputTask);
  const gateway = reviewTask
    ? byId.get(out(reviewTask.id)[0]?.to ?? "")
    : undefined;
  // The BPMN convention ends a rejection; when it does, "return for
  // correction" is the case's own rule, not a branch of the diagram.
  const returnInDiagram =
    !!gateway &&
    out(gateway.id)
      .filter((f) => !YES.test(f.name))
      .some((f) => byId.get(f.to)?.kind !== "endEvent");
  const roles = process.lanes.filter((l) => l.human);
  const aiSteps = steps.filter((n) => !isHumanTask(n));
  return { steps, inputTask, reviewTask, roles, aiSteps, returnInDiagram, byId };
}

export type ShapedProcess = ReturnType<typeof shapeProcess>;

/** The task a case is waiting on, from its status. */
export function currentTask(shaped: ShapedProcess, status: CaseStatus): ProcessNode | undefined {
  if (status === "draft" || status === "returned" || status === "failed") return shaped.inputTask;
  if (status === "review") return shaped.reviewTask;
  return undefined;
}

/** Which steps are done, for the stepper. */
export function stepState(
  shaped: ShapedProcess,
  status: CaseStatus,
  node: ProcessNode,
): "done" | "current" | "todo" {
  const order = shaped.steps.indexOf(node);
  const inputAt = shaped.steps.indexOf(shaped.inputTask as ProcessNode);
  const reviewAt = shaped.steps.indexOf(shaped.reviewTask as ProcessNode);
  if (status === "approved") return "done";
  if (status === "draft" || status === "returned" || status === "failed")
    return order === inputAt ? "current" : "todo";
  if (status === "running")
    return order <= inputAt ? "done" : order < reviewAt ? "current" : "todo";
  if (status === "review")
    return order < reviewAt ? "done" : order === reviewAt ? "current" : "todo";
  return order <= reviewAt ? "done" : "todo"; // rejected
}

// -- the review form -------------------------------------------------------------

const FORMATS: Record<string, RegExp> = {
  "DD/MM/YYYY": /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/,
  "YYYY-MM-DD": /^\d{4}-\d{2}-\d{2}$/,
  "HH:MM": /^([01]\d|2[0-3]):[0-5]\d$/,
};

export const formatOf = (spec: OutputSpec, field: string) =>
  Object.keys(FORMATS).find((k) => (spec.field_descriptions?.[field] ?? "").includes(k));
export const isList = (spec: OutputSpec, field: string) =>
  /^list/.test(spec.field_types?.[field] ?? "");
export const uncertainField = (spec: OutputSpec) =>
  spec.fields.find((f) => /uncertain/.test(f) && isList(spec, f));
export const humanize = (field: string) =>
  field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const show = (v: unknown): string =>
  v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);

export type FieldProblem = { kind: "required" | "allowed" | "format"; detail?: string };

/** The same checks wizard_api makes before it accepts an approval. */
export function fieldProblem(spec: OutputSpec, record: CaseRecord, field: string): FieldProblem | null {
  const value = record[field];
  const empty = value == null || show(value).trim() === "";
  if ((spec.required_fields ?? []).includes(field) && empty) return { kind: "required" };
  if (empty || typeof value !== "string") return null;
  const allowed = spec.allowed_values?.[field];
  if (allowed && !allowed.includes(value)) return { kind: "allowed", detail: allowed.join(", ") };
  const fmt = formatOf(spec, field);
  if (fmt && !FORMATS[fmt].test(value)) return { kind: "format", detail: fmt };
  return null;
}

export const formFields = (spec: OutputSpec) => {
  const unc = uncertainField(spec);
  return spec.fields.filter((f) => f !== unc);
};

export function problemCount(spec: OutputSpec, record: CaseRecord): number {
  return formFields(spec).filter((f) => fieldProblem(spec, record, f)).length;
}

/** The value a form input produced, in the record's own type. */
export function parseInput(spec: OutputSpec, field: string, raw: string): unknown {
  const text = raw.trim();
  if (text === "") return null;
  return isList(spec, field)
    ? text.split(",").map((s) => s.trim()).filter(Boolean)
    : text;
}

export function toCsv(record: CaseRecord): string {
  const keys = Object.keys(record);
  const q = (v: unknown) => `"${show(v).replace(/"/g, '""')}"`;
  return "\ufeff" + keys.join(",") + "\n" + keys.map((k) => q(record[k])).join(",") + "\n";
}

/** Whether an input data object is audio, so the screen offers recording. */
export const isAudioInput = (name: string | null) => /audio|voice|recording|ääni|puhe/i.test(name ?? "");

// -- a document result (a generated report) --------------------------------------

type Section = { id?: string; title?: string; text?: string };

/** A result made of sections of text (a report) rather than a flat record. */
export function isDocument(record: CaseRecord | null | undefined): boolean {
  const sections = record?.sections;
  return (
    Array.isArray(sections) &&
    sections.length > 0 &&
    sections.every((x) => !!x && typeof x === "object" && "text" in (x as object))
  );
}

/** The report as Markdown: title, then each section under its own heading. */
export function toMarkdown(record: CaseRecord): string {
  const parts: string[] = [];
  if (typeof record.title === "string") parts.push(`# ${record.title}`);
  for (const sec of (record.sections as Section[]) ?? []) {
    parts.push(`## ${sec.title ?? sec.id ?? ""}`.trimEnd(), String(sec.text ?? "").trim());
  }
  return parts.join("\n\n") + "\n";
}
