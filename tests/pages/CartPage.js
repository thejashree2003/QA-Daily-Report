export class CartPage {
  constructor(page) {
    this.page = page;
    this.items = page.locator('[data-test="inventory-item"]');
    this.continueShopping = page.locator('[data-test="continue-shopping"]');
    this.checkout = page.locator('[data-test="checkout"]');
    this.cartBadge = page.locator('[data-test="shopping-cart-badge"]');
  }

  itemByName(name) {
    return this.items.filter({ has: this.page.locator('[data-test="inventory-item-name"]', { hasText: name }) });
  }

  async remove(productName) {
    const slug = productName.toLowerCase().replace(/\s+/g, "-");
    await this.page.locator(`[data-test="remove-${slug}"]`).click();
  }
}
