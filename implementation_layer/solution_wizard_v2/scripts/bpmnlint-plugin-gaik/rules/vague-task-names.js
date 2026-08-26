/**
 * GAIK modeling guideline: task names must say what the task actually does
 * ("Extract invoice fields", "Transcribe call recording"), not a generic
 * placeholder that says nothing about the specific process.
 *
 * Starts as `warn` (S3-2) — promote to `error` once the PO signs off.
 */
const { is, isAny } = require("bpmnlint-utils");

const TASK_TYPES = [
  "bpmn:Task",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:ManualTask",
  "bpmn:SendTask",
  "bpmn:CallActivity",
];

// Exact (case-insensitive) matches for known-vague labels, plus a couple of
// obvious variants. Deliberately a denylist, not a fuzzy heuristic — false
// positives on a P0 warn-first rule erode trust in the rule faster than a
// few missed vague names do.
const VAGUE_LABELS = new Set([
  "ai step",
  "process data",
  "handle document",
  "process",
  "task",
  "step",
  "do something",
  "handle",
  "handle it",
]);

module.exports = function () {
  function check(node, reporter) {
    if (!isAny(node, TASK_TYPES) || is(node, "bpmn:SubProcess")) {
      return;
    }

    const name = (node.name || "").trim();
    if (!name) {
      return; // label-required (recommended config) already flags this
    }

    if (VAGUE_LABELS.has(name.toLowerCase())) {
      reporter.report(
        node.id,
        `Task name "${name}" is too vague — say what the task actually does (e.g. "Extract invoice fields", not "Process data")`,
        ["name"],
      );
    }
  }

  return { check };
};
