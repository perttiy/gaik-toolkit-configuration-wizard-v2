import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Chat panel, two ways a real agent turn goes wrong that a mock reply never
 * shows: it ends without a word (seen live: an empty assistant turn during
 * requirement gathering), and it takes minutes (finding 12/2 — "the bot freezes
 * with no sign it is working"). The chat endpoint is intercepted, so this runs
 * against the mock-store suite.
 */
test.describe("Chat panel — empty and slow replies", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a stream that ends without any text is shown as a failure, not an empty bubble", async ({
    page,
  }) => {
    await page.route("**/api/sessions/*/chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"done":true}\n\n',
      }),
    );
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    await page.getByRole("textbox").fill("Hei");
    await page.getByRole("button", { name: "Lähetä" }).click();

    await expect(
      page.getByRole("log").getByText("Agentti ei antanut vastausta. Lähetä viestisi uudelleen."),
    ).toBeVisible();
  });

  test("a long wait says the work is still going, and that stops when the answer arrives", async ({
    page,
  }) => {
    await page.clock.install();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/sessions/*/chat", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"delta":"Valmis."}\n\ndata: {"done":true}\n\n',
      });
    });
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    await page.getByRole("textbox").fill("Hei");
    await page.getByRole("button", { name: "Lähetä" }).click();

    const hint = page.getByTestId("chat-still-working");
    await expect(hint).toHaveCount(0);
    await page.clock.fastForward(21_000);
    await expect(hint).toBeVisible();

    release();
    await expect(page.getByRole("log").getByText("Valmis.")).toBeVisible();
    await expect(hint).toHaveCount(0);
  });
});

test.describe("Chat panel — connection lost mid-reply", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a reply cut off after some text is marked as possibly incomplete", async ({ page }) => {
    // The stream carries text, then an error frame — what the client sees when
    // the connection drops part-way through a long agent turn.
    await page.route("**/api/sessions/*/chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"delta":"Kirjaan tämän ja"}\n\ndata: {"error":true}\n\n',
      }),
    );
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    await page.getByRole("textbox").fill("Hei");
    await page.getByRole("button", { name: "Lähetä" }).click();

    const log = page.getByRole("log");
    await expect(log.getByText("Kirjaan tämän ja")).toBeVisible();
    await expect(log.getByText(/Yhteys katkesi kesken vastauksen/)).toBeVisible();
  });
});
