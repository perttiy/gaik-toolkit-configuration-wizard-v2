import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import path from "node:path";
import fs from "node:fs";

const SHOT_DIR = path.join(__dirname, "screenshots", "undo-restore");

test.describe("Blueprint undo / restore (#67)", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  });

  test("save then undo restores previous JSON", async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsDev(page);

    await page.locator("#session-title").fill(`Undo restore ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.getByTestId("blueprint-json-toggle").click();
    const editor = page.getByTestId("blueprint-json-editor");
    await expect(editor).toBeVisible();

    await page.screenshot({
      path: path.join(SHOT_DIR, "01-json-tab-initial.png"),
      fullPage: true,
    });

    const original = await editor.inputValue();
    const parsed = JSON.parse(original) as {
      steps: Array<{ id: string; name: string }>;
    };
    const inputStep = parsed.steps.find((s) => s.id === "input");
    expect(inputStep).toBeTruthy();
    const beforeName = inputStep!.name;

    parsed.steps = parsed.steps.map((s) =>
      s.id === "input" ? { ...s, name: "UNDO_MARKER_INPUT" } : s,
    );
    await editor.fill(JSON.stringify(parsed, null, 2));

    await page.screenshot({
      path: path.join(SHOT_DIR, "02-json-edited-before-save.png"),
      fullPage: true,
    });

    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("blueprint-version-label")).toContainText(/v2/);

    await page.screenshot({
      path: path.join(SHOT_DIR, "03-after-save-v2.png"),
      fullPage: true,
    });

    const afterSave = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    expect(afterSave.steps.find((s) => s.id === "input")?.name).toBe(
      "UNDO_MARKER_INPUT",
    );

    const undo = page.getByTestId("blueprint-undo");
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(page.getByTestId("blueprint-undo-ok")).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({
      path: path.join(SHOT_DIR, "04-after-undo-restored.png"),
      fullPage: true,
    });

    const afterUndo = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    expect(afterUndo.steps.find((s) => s.id === "input")?.name).toBe(beforeName);
    await expect(page.getByTestId("blueprint-version-label")).toContainText(/v3/);
  });
});
