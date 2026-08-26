#!/usr/bin/env node
/**
 * CLI helper for Next API routes: stdin BPMN XML → stdout lint JSON.
 * Keeps bpmnlint out of the webpack bundle (NodeResolver needs real require).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
const require = createRequire(path.join(appRoot, "package.json"));

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const xml = Buffer.concat(chunks).toString("utf8");
if (!xml.trim()) {
  console.error("missing xml on stdin");
  process.exit(2);
}

const { BpmnModdle } = require("bpmn-moddle");
const bpmnlint = require("bpmnlint");
const NodeResolver =
  require("bpmnlint/lib/resolver/node-resolver").default ||
  require("bpmnlint/lib/resolver/node-resolver");
const Linter = bpmnlint.Linter || bpmnlint.default;

// GAIK modeling-guideline rules (S3-2 / #64) — an in-repo plugin, not an npm
// package, so it's resolved directly here rather than through node_modules.
const gaikPlugin = require(path.join(__dirname, "bpmnlint-plugin-gaik", "index.js"));
const GAIK_PKG = "bpmnlint-plugin-gaik";

const nodeResolver = new NodeResolver({ require });
const resolver = {
  resolveRule(pkg, ruleName) {
    if (pkg === GAIK_PKG) {
      const rule = gaikPlugin.rules[ruleName];
      if (!rule) {
        throw new Error(`unknown rule <${ruleName}> from <${GAIK_PKG}>`);
      }
      return rule;
    }
    return nodeResolver.resolveRule(pkg, ruleName);
  },
  resolveConfig(pkg, configName) {
    if (pkg === GAIK_PKG) {
      const config = gaikPlugin.configs[configName];
      if (!config) {
        throw new Error(`unknown config <${configName}> from <${GAIK_PKG}>`);
      }
      return config;
    }
    return nodeResolver.resolveConfig(pkg, configName);
  },
};

const config = {
  extends: ["bpmnlint:recommended", "plugin:gaik/recommended"],
};

const moddle = new BpmnModdle();
const { rootElement } = await moddle.fromXML(xml);
const linter = new Linter({ config, resolver });
const reports = await linter.lint(rootElement);

const issues = [];
for (const [rule, items] of Object.entries(reports ?? {})) {
  for (const item of items ?? []) {
    const category =
      item.category === "error" ||
      item.category === "warn" ||
      item.category === "info"
        ? item.category
        : "error";
    issues.push({
      rule,
      id: item.id ?? "",
      message: item.message ?? rule,
      category,
    });
  }
}
const errors = issues.filter((i) => i.category === "error");
const warnings = issues.filter(
  (i) => i.category === "warn" || i.category === "info",
);
process.stdout.write(
  JSON.stringify({
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
  }),
);
