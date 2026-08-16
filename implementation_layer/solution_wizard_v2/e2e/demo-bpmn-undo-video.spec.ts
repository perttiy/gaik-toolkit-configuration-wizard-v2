import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import fs from "node:fs";
import path from "node:path";

/**
 * Demo recording — BPMN panel Kumoa (#67).
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=true \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3026 \
 *   PLAYWRIGHT_SLOW_MO=700 \
 *   npx playwright test e2e/demo-bpmn-undo-video.spec.ts --project=chromium
 *
 * Video is copied to e2e/videos/wizard-v2-bpmn-undo-demo-1080p.webm
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

test.describe("Wizard V2 BPMN undo demo video", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("BPMN canvas → edit → save → Kumoa", async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const video = page.video();

    await loginAsDev(page);
    await page.waitForTimeout(800);

    await page.goto("/sessions/ses_chatbot");
    await page.waitForURL(/\/sessions\/ses_chatbot$/);
    await page.waitForTimeout(1000);

    // Advance to Visuaalinen työnkulku (BPMN).
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await expect(
      page.getByRole("heading", { name: "Visuaalinen työnkulku (BPMN)" }),
    ).toBeVisible();
    await page.waitForTimeout(900);

    const workspacePanel = page.locator('[role="tabpanel"]:visible');
    await expect(workspacePanel.getByTestId("bpmn-save")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1600);

    // Create a new version via JSON (demo-friendly; sync lint can fail in mock).
    await page.getByRole("tab", { name: "Blueprint (JSON)" }).click();
    await page.waitForTimeout(900);

    const editor = page.getByTestId("blueprint-json-editor");
    await expect(editor).toBeVisible();
    const original = await editor.inputValue();
    const parsed = JSON.parse(original) as {
      steps: Array<{ id: string; name: string }>;
    };
    const beforeName =
      parsed.steps.find((s) => s.id === "input")?.name ?? "Customer question";

    parsed.steps = parsed.steps.map((s) =>
      s.id === "input" ? { ...s, name: "Voice note (BPMN demo)" } : s,
    );
    await editor.fill(JSON.stringify(parsed, null, 2));
    await page.waitForTimeout(1200);

    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1400);

    // Back to BPMN — show updated diagram, then Kumoa on the canvas panel.
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await expect(workspacePanel.getByTestId("bpmn-undo")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1800);

    const undo = workspacePanel.getByTestId("bpmn-undo");
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(workspacePanel.getByTestId("bpmn-undo-ok")).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1800);

    // Confirm restore on JSON tab briefly.
    await page.getByRole("tab", { name: "Blueprint (JSON)" }).click();
    await page.waitForTimeout(900);
    const after = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    expect(after.steps.find((s) => s.id === "input")?.name).toBe(beforeName);
    await page.waitForTimeout(1600);

    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await page.waitForTimeout(2200);

    await page.close();
    const videoPath = await video?.path();
    if (videoPath && fs.existsSync(videoPath)) {
      const dest1080 = path.join(OUT_DIR, "wizard-v2-bpmn-undo-demo-1080p.webm");
      const dest = path.join(OUT_DIR, "wizard-v2-bpmn-undo-demo.webm");
      fs.copyFileSync(videoPath, dest1080);
      fs.copyFileSync(videoPath, dest);
    }
  });
});
