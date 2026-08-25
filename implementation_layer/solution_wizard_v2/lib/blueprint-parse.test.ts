import { describe, expect, it } from "vitest";
import { parseBlueprintJson } from "@/lib/blueprint-parse";

describe("parseBlueprintJson", () => {
  it("parses a valid V2 blueprint", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        description: "d",
        goal: "g",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
      }),
    );
    expect(parsed?.steps[0]?.name).toBe("Syöte");
  });

  it("rejects invalid step types", () => {
    expect(
      parseBlueprintJson(
        JSON.stringify({
          name: "Demo",
          steps: [{ id: "x", name: "Bad", type: "unknown" }],
        }),
      ),
    ).toBeNull();
  });

  it("keeps integration_targets for BPMN data stores", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
        integration_targets: ["incident_reporting_database"],
      }),
    );
    expect(parsed?.integration_targets).toEqual(["incident_reporting_database"]);
  });

  it("accepts data_stores as alias for integration_targets", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
        data_stores: ["erp_system"],
      }),
    );
    expect(parsed?.integration_targets).toEqual(["erp_system"]);
  });

  it("keeps component settings (SME-4)", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [
          {
            id: "retrieve",
            name: "Retrieval",
            type: "ai",
            component: "pgvector",
            settings: { top_k: "5", ignored: 3 },
          },
        ],
      }),
    );
    expect(parsed?.steps[0]?.settings).toEqual({ top_k: "5" });
  });

  it("drops an empty settings object", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [{ id: "input", name: "Syöte", type: "io", settings: {} }],
      }),
    );
    expect(parsed?.steps[0]?.settings).toBeUndefined();
  });

  it("keeps valid output_fields (SME-7)", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
        output_fields: [
          {
            name: "Havaintotyyppi",
            type: "enum",
            allowedValues: ["Near miss", "safety observation"],
            required: true,
            missingBehavior: "default",
            defaultValue: "safety observation",
            rule: "Valitse yksi.",
          },
          { name: "Kuvaus", type: "text", required: false, missingBehavior: "empty" },
        ],
      }),
    );
    expect(parsed?.output_fields).toEqual([
      {
        name: "Havaintotyyppi",
        type: "enum",
        allowedValues: ["Near miss", "safety observation"],
        required: true,
        missingBehavior: "default",
        defaultValue: "safety observation",
        rule: "Valitse yksi.",
      },
      { name: "Kuvaus", type: "text", required: false, missingBehavior: "empty" },
    ]);
  });

  it("drops output_fields entries with an unknown type, keeps the rest", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
        output_fields: [
          { name: "Bad", type: "not-a-type", required: false, missingBehavior: "empty" },
          { name: "Good", type: "text", required: false, missingBehavior: "empty" },
        ],
      }),
    );
    expect(parsed?.output_fields).toEqual([
      { name: "Good", type: "text", required: false, missingBehavior: "empty" },
    ]);
  });

  it("omits output_fields when empty or absent", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
      }),
    );
    expect(parsed?.output_fields).toBeUndefined();
  });
});
