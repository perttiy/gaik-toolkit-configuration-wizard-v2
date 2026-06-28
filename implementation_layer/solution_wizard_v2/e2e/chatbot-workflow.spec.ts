import { expect, test } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";

/**
 * Smoke test for the seeded "Asiakaspalvelun chatbot" mock session (ses_chatbot).
 * Covers login → session list → wizard workspace → chat SSE → blueprint JSON → PoC mock run.
 */
test.describe("Asiakaspalvelun chatbot (mock)", () => {
  test("walks through chatbot use case in the wizard UI", async ({ page }) => {
    await loginAsDev(page);

    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();

    await page.getByRole("link", { name: "Asiakaspalvelun chatbot" }).click();
    await page.waitForURL(/\/sessions\/ses_chatbot$/);

    await expect(
      page.getByRole("heading", { name: "Asiakaspalvelun chatbot", level: 1 }),
    ).toBeVisible();

    const workspacePanel = page.locator('[role="tabpanel"]:visible');

    // Workflow tab — spike BPMN from V1 blueprint (bpmn-js); mock steps in collapsible details.
    await expect(workspacePanel.getByText("Read-only BPMN (bpmn-js)")).toBeVisible();
    await expect(workspacePanel.locator(".djs-container")).toBeVisible({
      timeout: 15_000,
    });
    await workspacePanel.getByText("mock step list").click();
    await expect(workspacePanel.getByText("Tietohaku (RAG)")).toBeVisible();
    await expect(workspacePanel.getByText("pgvector")).toBeVisible();

    // Chat — mock SSE reply references current phase (step 6 = Komponenttivalinta).
    const chatPanel = page.getByLabel("Keskustelu");
    const chatInput = chatPanel.getByLabel("Viesti wizardille");
    await chatInput.fill("Haluaisimme vastata tuotekysymyksiin automaattisesti.");
    await chatPanel.getByRole("button", { name: "Lähetä" }).click();

    await expect(chatPanel.getByText("Komponenttivalinta")).toBeVisible({
      timeout: 15_000,
    });
    await expect(chatPanel.getByText("Mock-vastaus")).toBeVisible();

    // Blueprint JSON tab.
    await page.getByRole("tab", { name: "Blueprint (JSON)" }).click();
    await expect(workspacePanel.locator("pre")).toContainText('"pgvector"');

    // PoC mock run.
    await page.getByRole("tab", { name: "PoC" }).click();
    await workspacePanel.getByRole("button", { name: "Aja PoC" }).click();
    await expect(workspacePanel.getByText("Onnistui")).toBeVisible({
      timeout: 15_000,
    });
  });
});
