describe('HelloWorld', () => {
    it("should show", function () {
        cy.visit("/");
        cy.wait(100000);
        cy.get('h1').contains('Welcome to Your Vue.js App')
    });
})