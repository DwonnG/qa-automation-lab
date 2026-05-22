import { faker } from "@faker-js/faker";

import { expect, test } from "../fixtures/auth.fixture";

test.describe("Items", () => {
  test("starts with the empty state", async ({ itemsPage }) => {
    await itemsPage.expectEmptyState();
  });

  test("adds an item and shows it in the table", async ({ itemsPage }) => {
    const name = faker.commerce.productName();

    await itemsPage.addItem(name, 7);

    await itemsPage.expectItemVisible(name);
  });

  test("edits an existing item", async ({ itemsPage }) => {
    const original = `original-${faker.string.alphanumeric(6)}`;
    const updated = `updated-${faker.string.alphanumeric(6)}`;

    await itemsPage.addItem(original, 1);
    await itemsPage.editItem(original, updated);

    await itemsPage.expectItemVisible(updated);
    await itemsPage.expectItemHidden(original);
  });

  test("deletes an item", async ({ itemsPage }) => {
    const name = `to-delete-${faker.string.alphanumeric(6)}`;

    await itemsPage.addItem(name, 1);
    await itemsPage.expectItemVisible(name);

    await itemsPage.deleteItem(name);

    await itemsPage.expectItemHidden(name);
  });

  test("blocks save when the name field is empty", async ({
    itemsPage,
    page,
  }) => {
    await itemsPage.openAddItemDialog();
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("alert")).toContainText(/required/i);
  });
});
