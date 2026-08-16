import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";

/**
 * Demo recording — browser viewport video (Playwright), not full-desktop OBS.
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=true \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3020 \
 *   PLAYWRIGHT_SLOW_MO=700 \
 *   npx playwright test e2e/demo-wizard-video.spec.ts --project=chromium
 */
test.use({
  video: {
    mode: "on",
    size: { width: 1920, height: 1080 },
  },
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});

test.describe("Wizard V2 demo video", () => {
  test("login → edit blueprint → save → undo", async ({ page }) => {
    test.setTimeout(180_000);

    await loginAsDev(page);
    await page.waitForTimeout(800);

    const title = `Demo video ${Date.now()}`;
    await page.locator("#session-title").fill(title);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);
    await page.waitForTimeout(1200);

    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await page.waitForTimeout(1400);
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.waitForTimeout(900);
    await page.getByTestId("blueprint-json-toggle").click();
    await page.waitForTimeout(400);

    const editor = page.getByTestId("blueprint-json-editor");
    await expect(editor).toBeVisible();

    const original = await editor.inputValue();
    const parsed = JSON.parse(original) as {
      steps: Array<{ id: string; name: string }>;
    };
    const beforeName =
      parsed.steps.find((s) => s.id === "input")?.name ?? "Syöte";

    parsed.steps = parsed.steps.map((s) =>
      s.id === "input" ? { ...s, name: "Voice note (demo)" } : s,
    );
    await editor.fill(JSON.stringify(parsed, null, 2));
    await page.waitForTimeout(1200);

    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1600);

    await page.getByTestId("blueprint-undo").click();
    await expect(page.getByTestId("blueprint-undo-ok")).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1800);

    const after = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    expect(after.steps.find((s) => s.id === "input")?.name).toBe(beforeName);

    await page.waitForTimeout(2200);
  });
});
