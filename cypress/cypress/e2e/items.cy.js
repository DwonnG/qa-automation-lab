import { faker } from "@faker-js/faker";

describe("Items", () => {
  beforeEach(() => {
    cy.resetStore();
    cy.login();
  });

  it("starts with the empty state", () => {
    cy.visit("/");
    cy.findByText(/no items yet/i).should("be.visible");
  });

  it("renders seeded items in the table", () => {
    cy.fixture("items").then((items) => {
      cy.login();
      cy.seedItems(items);
      cy.visit("/");

      items.forEach((item) => {
        cy.findByRole("cell", { name: item.name }).should("be.visible");
      });
    });
  });

  it("adds an item via the UI and verifies the table", () => {
    const name = faker.commerce.productName();
    cy.visit("/");

    cy.findByRole("button", { name: /add item/i }).click();
    cy.findByRole("dialog").within(() => {
      cy.findByLabelText(/name/i).type(name);
      cy.findByLabelText(/quantity/i).clear();
      cy.findByLabelText(/quantity/i).type("3");
      cy.findByRole("button", { name: /^save$/i }).click();
    });

    cy.findByRole("cell", { name }).should("be.visible");
  });

  it("deletes an item via the UI", () => {
    const name = `to-delete-${faker.string.alphanumeric(6)}`;
    cy.addItem({ name, quantity: 1 });
    cy.visit("/");
    cy.findByRole("cell", { name }).should("be.visible");

    cy.findByRole("button", {
      name: new RegExp(`delete ${name}`, "i"),
    }).click();

    cy.findByRole("cell", { name }).should("not.exist");
  });
});
