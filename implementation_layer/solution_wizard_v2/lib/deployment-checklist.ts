import type { Blueprint } from "@/lib/mock-sessions";

// SME-LC-1 (#52): a deployment checklist derived from the actual blueprint,
// not a generic hardcoded list — so it reflects what this specific solution
// actually needs (components, integration targets, review steps).

export type ChecklistItem = {
  id: string;
  kind: "component" | "integration" | "reviewer" | "fixed";
  /** For component/integration/reviewer items: the blueprint value the item is about. */
  detail?: string;
};

export function buildDeploymentChecklist(blueprint: Blueprint): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  const components = Array.from(
    new Set(
      blueprint.steps
        .map((s) => s.component)
        .filter((c): c is string => Boolean(c && c.trim())),
    ),
  );
  for (const component of components) {
    items.push({ id: `component:${component}`, kind: "component", detail: component });
  }

  for (const target of blueprint.integration_targets ?? []) {
    if (!target.trim()) continue;
    items.push({ id: `integration:${target}`, kind: "integration", detail: target });
  }

  for (const step of blueprint.steps) {
    if (step.type !== "human_review") continue;
    items.push({ id: `reviewer:${step.id}`, kind: "reviewer", detail: step.name });
  }

  items.push({ id: "secrets", kind: "fixed" });
  items.push({ id: "dry-run", kind: "fixed" });

  return items;
}
