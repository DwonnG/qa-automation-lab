import { DEMO_PIN, TOKEN_STORAGE_KEY } from "./credentials";
import { ADMIN_RESET_URL, ITEMS_URL, LOGIN_URL } from "./paths";

function loginViaApi(pin) {
  return cy
    .request({
      method: "POST",
      url: LOGIN_URL,
      body: { pin },
      failOnStatusCode: false,
    })
    .then((response) => {
      expect(response.status, `login status for pin ${pin}`).to.equal(200);
      return response.body.token;
    });
}

Cypress.Commands.add("login", (pin = DEMO_PIN) => {
  cy.session(
    ["login", pin],
    () => {
      loginViaApi(pin).then((token) => {
        cy.visit("/", {
          onBeforeLoad(win) {
            win.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
          },
        });
      });
    },
    {
      validate() {
        // The demo store can be reset between specs, which revokes previously
        // issued tokens — probe the API to force a re-login if so.
        cy.window()
          .its("sessionStorage")
          .invoke("getItem", TOKEN_STORAGE_KEY)
          .then((token) => {
            if (!token) {
              throw new Error("missing session token");
            }
            cy.request({
              method: "GET",
              url: ITEMS_URL,
              headers: { Authorization: `Bearer ${token}` },
              failOnStatusCode: false,
            })
              .its("status")
              .should("equal", 200);
          });
      },
      cacheAcrossSpecs: true,
    },
  );
});

Cypress.Commands.add("resetStore", () => {
  cy.request({ method: "POST", url: ADMIN_RESET_URL, failOnStatusCode: false });
});

Cypress.Commands.add("addItem", ({ name, quantity = 1 }) => {
  cy.window()
    .its("sessionStorage")
    .invoke("getItem", TOKEN_STORAGE_KEY)
    .then((token) => {
      expect(token, "session token").to.be.a("string");
      cy.request({
        method: "POST",
        url: ITEMS_URL,
        body: { name, quantity },
        headers: { Authorization: `Bearer ${token}` },
      })
        .its("status")
        .should("equal", 201);
    });
});

Cypress.Commands.add("seedItems", (items) => {
  items.forEach((item) => cy.addItem(item));
});
