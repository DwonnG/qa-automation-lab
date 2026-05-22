import { expect, type Page } from "@playwright/test";

import { BasePage } from "./BasePage";

export class ItemsPage extends BasePage {
  readonly url = "/";

  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: /^items$/i }),
    ).toBeVisible();
  }

  async openAddItemDialog(): Promise<void> {
    await this.page.getByRole("button", { name: /add item/i }).click();
    await expect(this.page.getByRole("dialog")).toBeVisible();
  }

  async addItem(name: string, quantity: number): Promise<void> {
    await this.openAddItemDialog();
    await this.page.getByLabel(/name/i).fill(name);
    const quantityField = this.page.getByLabel(/quantity/i);
    await quantityField.fill(String(quantity));
    await this.page.getByRole("button", { name: /^save$/i }).click();
    await expect(this.page.getByRole("dialog")).toBeHidden();
  }

  async editItem(currentName: string, newName: string): Promise<void> {
    await this.page
      .getByRole("button", { name: new RegExp(`edit ${currentName}`, "i") })
      .click();
    const nameField = this.page.getByLabel(/name/i);
    await nameField.fill(newName);
    await this.page.getByRole("button", { name: /^save$/i }).click();
    await expect(this.page.getByRole("dialog")).toBeHidden();
  }

  async deleteItem(name: string): Promise<void> {
    await this.page
      .getByRole("button", { name: new RegExp(`delete ${name}`, "i") })
      .click();
  }

  async expectItemVisible(name: string): Promise<void> {
    await expect(
      this.page.getByRole("cell", { name, exact: true }),
    ).toBeVisible();
  }

  async expectItemHidden(name: string): Promise<void> {
    await expect(
      this.page.getByRole("cell", { name, exact: true }),
    ).toBeHidden();
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.page.getByText(/no items yet/i)).toBeVisible();
  }
}
