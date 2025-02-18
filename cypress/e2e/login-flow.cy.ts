describe('Login Flow', () => {
    beforeEach(() => {
      cy.log('Visiting root URL');
      cy.visit('/', { timeout: 10000 }).then(() => {
        cy.log('Root URL loaded');
        cy.url().then(url => cy.log(`Current URL: ${url}`));
      });
    });
  
    it('logs in as a guest and redirects to dashboard', () => {
      cy.contains('Продолжить как гость', { timeout: 5000 }).click();
      cy.url().should('include', '/dashboard');
      cy.contains('Мои проповеди').should('be.visible');
    });
  });