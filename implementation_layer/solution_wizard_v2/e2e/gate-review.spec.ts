import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Gate 1 review (Gate1Review.tsx) and the generic Gate 2 approve bar —
 * previously untested beyond an incidental best-effort "click approve if
 * visible" inside the BPMN demo specs. Each test uses its own dedicated
 * e2e-only mock fixture (lib/mock-sessions.ts) so approving/rejecting one
 * never affects another test.
 */
test.describe("Gate 1 review", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("approve is disabled until business context is captured", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await expect(page.getByRole("heading", { name: "Gate 1", exact: true })).toBeVisible();
    const approveButton = page.getByRole("button", { name: /Hyväksy vaatimukset/ });
    await expect(approveButton).toBeDisabled();

    // The hint names what's missing so the SME knows what to keep answering.
    await expect(page.getByText("Nykyprosessi")).toBeVisible();
    await expect(page.getByText("Odotettu arvo")).toBeVisible();
  });

  test("reject records the rejection but gives no visible confirmation (#126)", async ({
    page,
  }) => {
    // Known gap, not a design choice: rejectGate() does set gate_statuses to
    // "rejected" (lib/mock-sessions.ts), and gate-timeline.tsx's colour
    // classes for it already exist, but neither the sidebar label nor
    // Gate1Review itself ever renders a rejected notice — Gate1Review isn't
    // even passed the gate status. Pinned here as current behaviour so a fix
    // (#126) shows up as an intentional test change, not a silent one.
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await page.getByRole("button", { name: "Hylkää" }).click();
    await expect(page.getByRole("heading", { name: "Gate 1", exact: true })).toBeVisible();
    await expect(page.getByText("Hylätty")).toHaveCount(0);
  });

  test("request changes regresses to the previous step", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();
    await expect(page.getByText("VAIHE 3 / 13")).toBeVisible();
  });

  test("business context and open assumptions render", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    await expect(page.getByText("Liiketoimintakonteksti")).toBeVisible();
    await expect(
      page.getByText("Three people manually review invoices every morning."),
    ).toBeVisible();
    await expect(page.getByText("Faster processing")).toBeVisible();

    await expect(page.getByText("Avoimet oletukset")).toBeVisible();
    await expect(page.getByText("Invoices arrive as PDF email attachments.")).toBeVisible();
    await expect(page.getByText("Currency is always EUR.")).toBeVisible();
    // One confirmed, one not — the counter in the card header reflects it.
    await expect(page.getByText("1 / 2 kuitattu")).toBeVisible();
  });

  test("approve advances past the gate once context is complete", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    const approveButton = page.getByRole("button", { name: /Hyväksy vaatimukset/ });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    await expect(page.getByText("VAIHE 5 / 13")).toBeVisible();
  });
});

test.describe("Gate 2 — generic approve/reject/request-changes bar", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("approve advances past Gate 2", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    await expect(page.getByText("Tämä on gate-vaihe")).toBeVisible();
    await page.getByRole("button", { name: /Hyväksy gate/ }).click();

    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible();
  });
});
