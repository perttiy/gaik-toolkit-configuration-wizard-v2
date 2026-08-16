/**
 * Server-side bpmnlint wrapper (Node only — do not import from client components).
 * Uses bpmnlint:recommended + GAIK convention warnings (#47 / #64).
 */
import { createRequire } from "node:module";
import { lintGaikConventions } from "@/lib/bpmn-gaik-lint";

const require = createRequire(import.meta.url);

export type BpmnLintIssue = {
  rule: string;
  id: string;
  message: string;
  category: "error" | "warn" | "info";
};

export type BpmnLintResult = {
  ok: boolean;
  errors: BpmnLintIssue[];
  warnings: BpmnLintIssue[];
  issues: BpmnLintIssue[];
};

type RawReport = {
  id?: string;
  message?: string;
  category?: string;
};

function loadLinter() {
  const { BpmnModdle } = require("bpmn-moddle") as {
    BpmnModdle: new () => {
      fromXML: (xml: string) => Promise<{ rootElement: unknown }>;
    };
  };
  const bpmnlint = require("bpmnlint") as {
    Linter?: new (opts: unknown) => { lint: (el: unknown) => Promise<Record<string, RawReport[]>> };
    default?: new (opts: unknown) => { lint: (el: unknown) => Promise<Record<string, RawReport[]>> };
  };
  const NodeResolverMod = require("bpmnlint/lib/resolver/node-resolver") as {
    default?: new () => unknown;
  };
  const Linter = bpmnlint.Linter ?? bpmnlint.default;
  if (!Linter) {
    throw new Error("bpmnlint Linter export missing");
  }
  const NodeResolver = NodeResolverMod.default ?? NodeResolverMod;
  return {
    moddle: new BpmnModdle(),
    linter: new Linter({
      config: { extends: "bpmnlint:recommended" },
      resolver: new (NodeResolver as new () => unknown)(),
    }),
  };
}

export async function lintBpmnXml(xml: string): Promise<BpmnLintResult> {
  const { moddle, linter } = loadLinter();
  const { rootElement } = await moddle.fromXML(xml);
  const reports = await linter.lint(rootElement);

  const issues: BpmnLintIssue[] = [];
  for (const [rule, items] of Object.entries(reports ?? {})) {
    for (const item of items ?? []) {
      const category =
        item.category === "error" || item.category === "warn" || item.category === "info"
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

  const gaik = await lintGaikConventions(xml);
  issues.push(...gaik.issues);

  const errors = issues.filter((i) => i.category === "error");
  const warnings = issues.filter((i) => i.category === "warn" || i.category === "info");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}
