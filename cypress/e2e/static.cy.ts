describe('Static Test', () => {
    it('visits a known working page', () => {
      cy.visit('https://example.com');
      cy.contains('Example Domain').should('be.visible');
    });
  });