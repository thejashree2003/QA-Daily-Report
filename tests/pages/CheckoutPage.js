export class CheckoutPage {
  constructor(page) {
    this.page = page;
    this.firstName = page.locator('[data-test="firstName"]');
    this.lastName = page.locator('[data-test="lastName"]');
    this.postalCode = page.locator('[data-test="postalCode"]');
    this.continueButton = page.locator('[data-test="continue"]');
    this.cancelButton = page.locator('[data-test="cancel"]');
    this.finishButton = page.locator('[data-test="finish"]');
    this.error = page.locator('[data-test="error"]');
    this.paymentInfo = page.locator('[data-test="payment-info-label"]');
    this.shippingInfo = page.locator('[data-test="shipping-info-label"]');
    this.subtotal = page.locator('[data-test="subtotal-label"]');
    this.tax = page.locator('[data-test="tax-label"]');
    this.total = page.locator('[data-test="total-label"]');
    this.completeHeader = page.locator('[data-test="complete-header"]');
    this.backHome = page.locator('[data-test="back-to-products"]');
  }

  async fillInfo(first, last, zip) {
    await this.firstName.fill(first);
    await this.lastName.fill(last);
    await this.postalCode.fill(zip);
  }
}
