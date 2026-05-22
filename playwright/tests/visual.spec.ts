import { expect, test } from "../fixtures/auth.fixture";

// Pixel-diff baselines are platform-specific; gate behind RUN_VISUAL_TESTS=1 so
// CI doesn't fail until a baseline exists for the runner's OS+browser combo.
const VISUAL_ENABLED = process.env.RUN_VISUAL_TESTS === "1";

test.describe("Visual smoke", () => {
  test.skip(
    !VISUAL_ENABLED,
    "Set RUN_VISUAL_TESTS=1 to run visual regression (requires platform-matched baseline).",
  );

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
