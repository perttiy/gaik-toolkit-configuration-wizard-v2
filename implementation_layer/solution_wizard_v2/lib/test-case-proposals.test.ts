import { describe, expect, it } from "vitest";
import { buildTestCaseProposals } from "@/lib/test-case-proposals";

describe("buildTestCaseProposals", () => {
  it("pairs each answered point into a numbered test case", () => {
    const proposals = buildTestCaseProposals(
      ["What task should the system support?", "Who will use the system?"],
      ["Classify incoming invoices", "Finance team"],
    );
    expect(proposals).toEqual([
      {
        id: "tc-1",
        requirement: "What task should the system support?",
        expectation: "Classify incoming invoices",
      },
      {
        id: "tc-2",
        requirement: "Who will use the system?",
        expectation: "Finance team",
      },
    ]);
  });

  it("skips points with no answer or a blank answer", () => {
    const proposals = buildTestCaseProposals(
      ["Q1", "Q2", "Q3"],
      ["A1", "  ", ""],
    );
    expect(proposals.map((p) => p.requirement)).toEqual(["Q1"]);
  });

  it("returns an empty list when there are no points", () => {
    expect(buildTestCaseProposals([], [])).toEqual([]);
  });
});
