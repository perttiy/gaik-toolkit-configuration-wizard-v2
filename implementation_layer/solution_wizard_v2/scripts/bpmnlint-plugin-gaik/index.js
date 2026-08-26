/**
 * bpmnlint-plugin-gaik — GAIK modeling-guideline checks (S3-2 / #64).
 *
 * In-repo bpmnlint plugin (not published to npm): shaped like a real
 * bpmnlint plugin (`rules` + `configs.recommended`) so it can be lifted out
 * to its own package later without changing the rule modules, but resolved
 * directly by scripts/lint-bpmn.mjs's custom resolver today instead of
 * through node_modules.
 *
 * Rules, all `warn` for now — promote to `error` after PO sign-off:
 *  - vague-task-names: reject generic task labels ("AI step", "Process data")
 *  - gateway-question-form: gateway labels should read as a question ("...?")
 *  - data-object-is-data: data-object names should be nouns (the data),
 *    not the verb phrase of the task that produced them
 */
module.exports = {
  rules: {
    "vague-task-names": require("./rules/vague-task-names"),
    "gateway-question-form": require("./rules/gateway-question-form"),
    "data-object-is-data": require("./rules/data-object-is-data"),
  },
  configs: {
    recommended: {
      rules: {
        "gaik/vague-task-names": "warn",
        "gaik/gateway-question-form": "warn",
        "gaik/data-object-is-data": "warn",
      },
    },
  },
};
