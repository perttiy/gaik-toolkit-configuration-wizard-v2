// SME-LC-2 (#53): propose test cases from the requirements actually gathered
// in steps 1–3, rather than a generic checklist. By the PoC step, Gate 1
// already required every point to be answered, so points/answers pair 1:1.

export type TestCaseProposal = {
  id: string;
  requirement: string;
  expectation: string;
};

export function buildTestCaseProposals(
  points: string[],
  answers: string[],
): TestCaseProposal[] {
  return points
    .map((point, i) => ({ point, answer: answers[i] }))
    .filter((p): p is { point: string; answer: string } => Boolean(p.answer?.trim()))
    .map(({ point, answer }, i) => ({
      id: `tc-${i + 1}`,
      requirement: point,
      expectation: answer,
    }));
}
