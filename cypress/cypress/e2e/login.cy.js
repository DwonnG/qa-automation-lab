import { DEMO_PIN, TOKEN_STORAGE_KEY } from "../support/credentials";

describe("Login", () => {
  beforeEach(() => {
    cy.resetStore();
  });

  it("logs in with the demo PIN and lands on the items page", () => {
    cy.visit("/");
    cy.findByLabelText(/PIN/i).type(DEMO_PIN);
    cy.findByRole("button", { name: /sign in/i }).click();

    cy.findByRole("heading", { name: /^items$/i }).should("be.visible");
    cy.window()
      .its("sessionStorage")
      .invoke("getItem", TOKEN_STORAGE_KEY)
      .should("exist");
  });

  it("shows a generic error for a wrong PIN", () => {
    cy.visit("/");
    cy.findByLabelText(/PIN/i).type("111111");
    cy.findByRole("button", { name: /sign in/i }).click();

    cy.findByRole("alert").should("contain.text", "Invalid PIN");
  });

  it("blocks submission for a too-short PIN", () => {
    cy.visit("/");
    cy.findByLabelText(/PIN/i).type("123");
    cy.findByRole("button", { name: /sign in/i }).click();

    cy.findByRole("alert").should("contain.text", "6 digits");
  });
});
