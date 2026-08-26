/**
 * GAIK modeling guideline: a data object's name is the *data* that flows
 * through the process (Audio File, Transcript, Structured JSON) — not a
 * copy of the task title that produced it ("Extract Fields", "Transcribe
 * Audio"). Mixing the two makes data objects and tasks indistinguishable
 * at a glance.
 *
 * Starts as `warn` (S3-2) — promote to `error` once the PO signs off.
 */
const { is } = require("bpmnlint-utils");

// First-word check: task titles are verb phrases ("Extract invoice
// fields"), data-object names are nouns ("Invoice Fields"). A denylist of
// common process-verbs catches the task-title pattern without needing NLP.
const ACTION_VERBS = new Set([
  "extract",
  "generate",
  "process",
  "classify",
  "transcribe",
  "validate",
  "review",
  "approve",
  "send",
  "export",
  "collect",
  "handle",
  "create",
  "build",
  "run",
  "check",
  "analyze",
  "analyse",
]);

module.exports = function () {
  function check(node, reporter) {
    if (!is(node, "bpmn:DataObjectReference")) {
      return;
    }

    const name = (node.name || "").trim();
    if (!name) {
      return;
    }

    const firstWord = name.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
    if (firstWord && ACTION_VERBS.has(firstWord)) {
      reporter.report(
        node.id,
        `Data object name "${name}" looks like a task title, not data — name the data itself (e.g. "Transcript", not "Transcribe Audio")`,
        ["name"],
      );
    }
  }

  return { check };
};
