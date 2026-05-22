import { ITEMS_URL } from "../support/paths";

describe("Network intercepts", () => {
  beforeEach(() => {
    cy.resetStore();
    cy.login();
  });

  it("stubs the items list to render a deterministic table", () => {
    const stubbed = [
      { id: "stub-1", name: "stubbed apples", quantity: 11 },
      { id: "stub-2", name: "stubbed bananas", quantity: 22 },
    ];

    cy.intercept("GET", ITEMS_URL, { statusCode: 200, body: stubbed }).as(
      "listItems",
    );

    cy.visit("/");
    cy.wait("@listItems");

    cy.findByRole("cell", { name: "stubbed apples" }).should("be.visible");
    cy.findByRole("cell", { name: "stubbed bananas" }).should("be.visible");
  });

  it("surfaces the failure state when items list errors", () => {
    cy.intercept("GET", ITEMS_URL, {
      statusCode: 500,
      body: { detail: "boom" },
    }).as("listFail");

    cy.visit("/");
    cy.wait("@listFail");

    cy.findByRole("alert").should("contain.text", "Failed to load items");
  });

  it("shows a loading state while the items request is in flight", () => {
    cy.intercept("GET", ITEMS_URL, (req) => {
      req.on("response", (res) => {
        res.setDelay(800);
      });
    }).as("slowList");

    cy.visit("/");
    cy.findByRole("status").should("contain.text", "Loading items");
    cy.wait("@slowList");
  });
});
