import { expect, test } from "../fixtures/auth.fixture";

test.describe("Visual smoke", () => {
  test("items page empty state matches snapshot", async ({
    itemsPage,
    page,
  }) => {
    await itemsPage.expectEmptyState();
    await expect(page).toHaveScreenshot("items-empty.png", {
      maxDiffPixelRatio: 0.02,
      fullPage: true,
    });
  });
});
