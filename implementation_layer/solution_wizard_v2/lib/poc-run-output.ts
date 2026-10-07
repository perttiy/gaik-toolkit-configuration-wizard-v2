/**
 * What a sandbox run wrote to `output/`, as the PoC tab shows it.
 *
 * wizard_api reads the run's log between the output markers and answers with
 * the same reading a case gets (`GET /sessions/{id}/runs/{run_id}/output`):
 * the record (the JSON whose keys are the output fields), the grounding check,
 * the transcript, the document, and every printed file. The tab used to show
 * the raw log only, with the result somewhere in it.
 */

export type RunRecord = Record<string, unknown>;
export type RunOutputFile = { name: string; body: string };

export type PocRunOutput = {
  runId: string | null;
  record: RunRecord | RunRecord[] | null;
  validation: (RunRecord & { passed?: boolean }) | null;
  transcript: string;
  document: string;
  files: RunOutputFile[];
};

export const NO_RUN_OUTPUT: PocRunOutput = {
  runId: null,
  record: null,
  validation: null,
  transcript: "",
  document: "",
  files: [],
};

const isRecord = (v: unknown): v is RunRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function pocRunOutput(raw: unknown): PocRunOutput {
  if (!isRecord(raw)) return NO_RUN_OUTPUT;
  const record = isRecord(raw.record)
    ? raw.record
    : Array.isArray(raw.record) && raw.record.every(isRecord)
      ? (raw.record as RunRecord[])
      : null;
  const files = Array.isArray(raw.files)
    ? raw.files
        .filter(isRecord)
        .filter((f) => typeof f.name === "string" && typeof f.body === "string")
        .map((f) => ({ name: f.name as string, body: f.body as string }))
    : [];
  return {
    runId: typeof raw.runId === "string" ? raw.runId : typeof raw.run_id === "string" ? raw.run_id : null,
    record,
    validation: isRecord(raw.validation) ? (raw.validation as PocRunOutput["validation"]) : null,
    transcript: typeof raw.transcript === "string" ? raw.transcript : "",
    document: typeof raw.document === "string" ? raw.document : "",
    files,
  };
}

/** The run printed at least one output file. */
export const hasRunOutput = (o: PocRunOutput): boolean => o.files.length > 0;

/** `incident_location` reads as "Incident location". */
export function fieldLabel(field: string): string {
  const words = field.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : field;
}

/** A value as one readable string: lists of plain values on one line, nested data as JSON. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== "object")) {
    return value.map((v) => valueText(v)).join(", ");
  }
  return JSON.stringify(value, null, 2);
}

/** The record's fields in the order the run wrote them, each with its value as text. */
export function recordRows(record: RunRecord): { field: string; label: string; value: string }[] {
  return Object.entries(record).map(([field, value]) => ({
    field,
    label: fieldLabel(field),
    value: valueText(value),
  }));
}

export type DocumentSection = { title: string; text: string };

/**
 * A document result (a generated report) is a record whose `sections` are
 * titled texts; those read better as a document than as a table. Null for an
 * ordinary record.
 */
export function documentSections(record: RunRecord): DocumentSection[] | null {
  const sections = record.sections;
  if (!Array.isArray(sections) || sections.length === 0 || !sections.every(isRecord)) return null;
  return sections.map((s, i) => ({
    title: typeof s.title === "string" && s.title ? s.title : `${i + 1}`,
    text: valueText(s.text),
  }));
}
