import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";

// Environment-agnostic smoke check: works against the local mock-mode dev
// server (the default `npm run test:e2e` target) AND a real deployment like
// the Rahti dev environment (`npm run test:e2e:rahti`). Deliberately does
// NOT assert on mock-seeded session titles ("Customer service chatbot" etc.)
// — those only exist locally. Every run against a real backend creates one
// new session there; nothing here deletes it.

test.describe("Smoke — login, session list, create a session", () => {
  test("logs in and sees the session list", async ({ page }) => {
    await loginAsDev(page);
    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();
  });

  test("creates a new session and reaches the wizard shell", async ({ page }) => {
    await loginAsDev(page);

    const title = `e2e smoke ${new Date().toISOString()}`;
    await page.locator("#session-title").fill(title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();

    await page.waitForURL(/\/sessions\//);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Session start" }).first()).toBeVisible();
  });

  test("unknown session id returns not found", async ({ page }) => {
    await loginAsDev(page);
    const response = await page.goto("/sessions/does-not-exist-e2e-smoke");
    expect(response?.status()).toBe(404);
  });
});
