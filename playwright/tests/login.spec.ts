import { expect, test } from "@playwright/test";

import { DEMO_PIN } from "../lib/credentials";
import { LoginPage } from "../pages/LoginPage";

test.describe("Login", () => {
  test("logs in with the demo PIN and lands on the items page", async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();
    const itemsPage = await login.loginWith(DEMO_PIN);
    await expect(
      itemsPage["page"].getByRole("heading", { name: /^items$/i }),
    ).toBeVisible();
  });

  test("rejects a wrong PIN with a generic error", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.submitInvalidPin("111111");
    await login.expectInvalidPinError();
  });

  test("blocks submission when the PIN is too short", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.submitInvalidPin("123");
    await expect(page.getByRole("alert")).toContainText(/6 digits/i);
  });
});
