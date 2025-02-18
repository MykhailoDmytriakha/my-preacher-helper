import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    setupNodeEvents(on, config) {
      console.log('Cypress baseUrl:', config.baseUrl);
    },
  }
});