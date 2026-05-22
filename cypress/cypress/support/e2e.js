import "@testing-library/cypress/add-commands";

import "./commands.js";

Cypress.on("uncaught:exception", () => false);
