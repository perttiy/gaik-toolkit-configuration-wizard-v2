import { test, expect } from "@playwright/test";
import { DEV_USERS, loginAsDev } from "./helpers/auth";
import { waitForApiHealthy } from "./helpers/api";

const STACK_E2E = process.env.PLAYWRIGHT_STACK_E2E === "true";

/**
 * #126 — Gate 1 "Request changes" / "Reject" against the real stack
 * (UI + wizard_api + Postgres), so the assertions cover the API path rather
 * than the in-memory mock store.
 *
 * Run via Docker: ./scripts/docker-test.sh --step stack-e2e
 *
 * What used to happen and must not happen again:
 *   - "Request changes" moved the session back to step 3 with no explanation.
 *   - The feedback was never recorded (empty `user_content` is refused by the
 *     API, so the acknowledgement was dropped silently).
 *   - "Reject" left no visible trace anywhere in the UI.
 */
test.describe("#126 Gate 1 objections carry a reason (stack)", () => {
  test.skip(!STACK_E2E, "set PLAYWRIGHT_STACK_E2E=true (docker-test.sh --step stack-e2e)");

  test.beforeAll(async ({ request }) => {
    await waitForApiHealthy(request);
  });

  test("request changes stays on the gate and records the reason", async ({ page }) => {
    test.setTimeout(120_000);

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(`Gate1 feedback ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    // Steps 1–3 are gathering; step 4 is Gate 1.
    for (let step = 2; step <= 4; step += 1) {
      await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
      await expect(page.getByText(`VAIHE ${step} / 13`)).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: "Vaatimusten tarkistus" }),
    ).toBeVisible();

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = page.getByLabel("Mitä pitää muuttaa? (pakollinen)");
    await expect(reason).toBeVisible();

    // An empty objection is refused by the form itself — nothing is submitted.
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();
    await expect(reason).toHaveJSProperty("validity.valid", false);
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();

    const feedback = "Syötteet tulevat skannattuina PDF-tiedostoina, ei Word-muodossa.";
    await reason.fill(feedback);
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();

    // The session stays on Gate 1 — the old behaviour dropped it to step 3 —
    // and both the reason and the acknowledgement land in the chat.
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    await expect(page.getByText(feedback)).toBeVisible();
    await expect(page.getByText(/Muutospyyntö kirjattu/)).toBeVisible();
  });

  test("reject records the reason and shows the rejected state", async ({ page }) => {
    test.setTimeout(120_000);

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(`Gate1 reject ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    for (let step = 2; step <= 4; step += 1) {
      await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
      await expect(page.getByText(`VAIHE ${step} / 13`)).toBeVisible();
    }

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = "Vaatimukset eivät vastaa sitä mitä prosessissa oikeasti tehdään.";
    await page.getByLabel("Mitä pitää muuttaa? (pakollinen)").fill(reason);
    await page.getByRole("button", { name: "Hylkää" }).click();

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(/Tämä gate on hylätty/)).toBeVisible();
  });
});
