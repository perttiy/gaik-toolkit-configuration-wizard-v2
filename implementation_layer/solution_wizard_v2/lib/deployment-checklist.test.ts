import { describe, expect, it } from "vitest";
import { buildDeploymentChecklist } from "@/lib/deployment-checklist";
import type { Blueprint } from "@/lib/mock-sessions";

function blueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    name: "Demo",
    description: "",
    goal: "",
    steps: [],
    ...overrides,
  };
}

describe("buildDeploymentChecklist", () => {
  it("always includes the fixed secrets and dry-run items", () => {
    const items = buildDeploymentChecklist(blueprint());
    expect(items.map((i) => i.id)).toEqual(["secrets", "dry-run"]);
  });

  it("adds one item per distinct component used in the steps", () => {
    const items = buildDeploymentChecklist(
      blueprint({
        steps: [
          { id: "a", name: "A", type: "ai", component: "pgvector" },
          { id: "b", name: "B", type: "ai", component: "pgvector" },
          { id: "c", name: "C", type: "ai", component: "azure_openai" },
          { id: "d", name: "D", type: "io" },
        ],
      }),
    );
    const componentItems = items.filter((i) => i.kind === "component");
    expect(componentItems.map((i) => i.detail).sort()).toEqual([
      "azure_openai",
      "pgvector",
    ]);
  });

  it("adds one item per integration target", () => {
    const items = buildDeploymentChecklist(
      blueprint({ integration_targets: ["erp_system", "crm"] }),
    );
    const integrationItems = items.filter((i) => i.kind === "integration");
    expect(integrationItems.map((i) => i.detail)).toEqual(["erp_system", "crm"]);
  });

  it("adds a reviewer item for every human_review step, named after the step", () => {
    const items = buildDeploymentChecklist(
      blueprint({
        steps: [
          { id: "review1", name: "Approve output", type: "human_review" },
          { id: "gen", name: "Generate", type: "ai" },
        ],
      }),
    );
    const reviewerItems = items.filter((i) => i.kind === "reviewer");
    expect(reviewerItems).toEqual([
      { id: "reviewer:review1", kind: "reviewer", detail: "Approve output" },
    ]);
  });

  it("ignores blank integration targets", () => {
    const items = buildDeploymentChecklist(blueprint({ integration_targets: ["  ", ""] }));
    expect(items.filter((i) => i.kind === "integration")).toEqual([]);
  });
});
