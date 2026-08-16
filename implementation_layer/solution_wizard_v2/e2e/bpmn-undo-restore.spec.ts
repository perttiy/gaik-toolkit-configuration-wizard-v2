import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import path from "node:path";
import fs from "node:fs";

const SHOT_DIR = path.join(__dirname, "screenshots", "bpmn-undo-restore");

test.describe("BPMN canvas undo / restore (#67)", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("Kumoa on flow tab restores previous blueprint + BPMN", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await page.waitForURL(/\/sessions\/ses_chatbot$/);

    // Advance to phase 8 (Visuaalinen työnkulku / BPMN).
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await expect(page.getByText("Visuaalinen työnkulku (BPMN)")).toBeVisible();

    const workspacePanel = page.locator('[role="tabpanel"]:visible');
    await expect(workspacePanel.getByTestId("bpmn-save")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: path.join(SHOT_DIR, "01-bpmn-initial.png"),
      fullPage: true,
    });

    // Create a new blueprint version via JSON (avoids bpmnlint sync path).
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.getByTestId("blueprint-json-toggle").click();
    const editor = page.getByTestId("blueprint-json-editor");
    await expect(editor).toBeVisible();
    const original = await editor.inputValue();
    const parsed = JSON.parse(original) as {
      steps: Array<{ id: string; name: string }>;
    };
    const beforeName = parsed.steps.find((s) => s.id === "input")!.name;
    parsed.steps = parsed.steps.map((s) =>
      s.id === "input" ? { ...s, name: "BPMN_UNDO_MARKER" } : s,
    );
    await editor.fill(JSON.stringify(parsed, null, 2));
    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: path.join(SHOT_DIR, "02-after-json-save.png"),
      fullPage: true,
    });

    // Undo from the BPMN / Työnkulku panel.
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await expect(workspacePanel.getByTestId("bpmn-undo")).toBeVisible({
      timeout: 15_000,
    });
    await expect(workspacePanel.getByTestId("bpmn-version-label")).toBeVisible();

    await page.screenshot({
      path: path.join(SHOT_DIR, "03-bpmn-before-undo.png"),
      fullPage: true,
    });

    const undo = workspacePanel.getByTestId("bpmn-undo");
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(workspacePanel.getByTestId("bpmn-undo-ok")).toBeVisible({
      timeout: 15_000,
    });

    await page.screenshot({
      path: path.join(SHOT_DIR, "04-after-bpmn-undo.png"),
      fullPage: true,
    });

    await page.getByRole("tab", { name: "Blueprint" }).click();
    const after = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    expect(after.steps.find((s) => s.id === "input")?.name).toBe(beforeName);
  });
});
