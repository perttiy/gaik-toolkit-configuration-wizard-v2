/**
 * GAIK modeling guideline: a gateway label is a decision, so it reads best
 * as a question ("Approved?", "High risk?") rather than a statement or a
 * bare verb phrase.
 *
 * Starts as `warn` (S3-2) — promote to `error` once the PO signs off.
 */
const { is } = require("bpmnlint-utils");

module.exports = function () {
  function check(node, reporter) {
    if (!is(node, "bpmn:Gateway")) {
      return;
    }

    const name = (node.name || "").trim();
    if (!name) {
      return; // label-required (recommended config) already flags this
    }

    if (!name.endsWith("?")) {
      reporter.report(
        node.id,
        `Gateway label "${name}" should be phrased as a question (e.g. "Approved?"), so the decision it represents is clear`,
        ["name"],
      );
    }
  }

  return { check };
};
