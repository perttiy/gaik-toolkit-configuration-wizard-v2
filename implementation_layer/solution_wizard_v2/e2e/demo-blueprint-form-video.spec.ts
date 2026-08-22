import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import fs from "node:fs";
import path from "node:path";

/**
 * Demo — human-friendly Blueprint form editor (Umair feedback #1).
 *
 * Shows the "Blueprint" tab as a readable + editable form (no raw JSON by
 * default): grouped fields, collapsible step cards, per-step type/component,
 * with the raw JSON tucked behind a "Kehittäjänäkymä (JSON)" drawer.
 *
 *   WIZARD_API_URL= \
 *   PLAYWRIGHT_SLOW_MO=500 \
 *   npx playwright test e2e/demo-blueprint-form-video.spec.ts --project=chromium --workers=1
 *
 * Video → e2e/videos/wizard-v2-blueprint-form-demo-1080p.webm
 */
test.use({
  video: {
    mode: "on",
    size: { width: 1920, height: 1080 },
  },
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});

const OUT_DIR = path.join(__dirname, "videos");

test.describe("Wizard V2 Blueprint form demo video", () => {
  test.skip(!!process.env.CI, "demo video — run locally with PLAYWRIGHT_SLOW_MO");

  test.beforeEach(async ({ request }) => {
    try {
      await resetMockSessions(request);
    } catch {
      /* API mode */
    }
  });

  test("readable + editable blueprint form", async ({ page }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const video = page.video();

    await loginAsDev(page);
    await page.waitForTimeout(900);

    const title = "Blueprint form demo";
    await page.locator("#session-title").fill(title);
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\/(ses_[a-f0-9]+|[0-9a-f-]{36})$/i);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await page.waitForTimeout(1200);

    // Advance to the BPMN visual phase so the workflow is realistic.
    for (let i = 0; i < 12; i++) {
      const phaseHeading = page.locator("main h2");
      const phase = (await phaseHeading.textContent())?.trim() ?? "";
      if (phase.includes("Visuaalinen työnkulku")) break;

      const approve = page.getByRole("button", { name: /Hyväksy gate/ });
      if (await approve.isVisible().catch(() => false)) {
        await approve.click();
      } else {
        await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
      }
      await expect(phaseHeading).not.toHaveText(phase, { timeout: 15_000 });
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1200);

    // --- Open the human-friendly Blueprint form ---
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.waitForTimeout(1600);

    // Grouped, readable fields (name / goal / description).
    await page.getByTestId("blueprint-field-goal").click();
    await page.waitForTimeout(1200);

    // Step cards are collapsed by default — expand one to reveal its fields.
    await page.getByTestId("blueprint-step-1-toggle").click();
    await page.waitForTimeout(1400);

    // Edit a step name via the form (no JSON).
    const stepName = page.getByTestId("blueprint-step-1-name");
    await stepName.click();
    await stepName.fill("Tekoälyluokittelu (demo)");
    await page.waitForTimeout(1200);

    // Change its type through the dropdown.
    await page.getByTestId("blueprint-step-1-type").selectOption("ai");
    await page.waitForTimeout(1200);

    // Collapse it again to show the compact overview.
    await page.getByTestId("blueprint-step-1-toggle").click();
    await page.waitForTimeout(1400);

    // Raw JSON still available for power users behind the drawer.
    await page.getByTestId("blueprint-json-toggle").click();
    await page.waitForTimeout(1600);
    await page.getByTestId("blueprint-json-toggle").click();
    await page.waitForTimeout(1000);

    // Save via the form.
    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1600);

    // Same edit reflected in the BPMN workflow view.
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await page.waitForTimeout(2000);

    await page.close();
    const videoPath = await video?.path();
    if (videoPath && fs.existsSync(videoPath)) {
      const dest1080 = path.join(
        OUT_DIR,
        "wizard-v2-blueprint-form-demo-1080p.webm",
      );
      const dest = path.join(OUT_DIR, "wizard-v2-blueprint-form-demo.webm");
      fs.copyFileSync(videoPath, dest1080);
      fs.copyFileSync(videoPath, dest);
    }
  });
});
