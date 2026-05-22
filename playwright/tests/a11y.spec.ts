import AxeBuilder from "@axe-core/playwright";
import type { Result } from "axe-core";

import { expect, test } from "../fixtures/auth.fixture";

const BLOCKING_IMPACTS = new Set<NonNullable<Result["impact"]>>([
  "critical",
  "serious",
]);

function blockingViolations(violations: Result[]): Result[] {
  return violations.filter(
    (v) => v.impact !== null && BLOCKING_IMPACTS.has(v.impact!),
  );
}

test.describe("Accessibility", () => {
  test("login page has no critical or serious violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("heading", { name: /sign in/i }).waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["color-contrast"])
      .analyze();

    expect(blockingViolations(results.violations)).toEqual([]);
  });

  test("items page has no critical or serious violations", async ({
    itemsPage,
    page,
  }) => {
    await itemsPage.waitForReady();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["color-contrast"])
      .analyze();

    expect(blockingViolations(results.violations)).toEqual([]);
  });

  test("item dialog is accessible when open", async ({ itemsPage, page }) => {
    await itemsPage.openAddItemDialog();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .include('[role="dialog"]')
      .disableRules(["color-contrast"])
      .analyze();

    expect(blockingViolations(results.violations)).toEqual([]);
  });
});
