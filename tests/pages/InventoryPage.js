export class InventoryPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator('[data-test="title"]');
    this.cartLink = page.locator('[data-test="shopping-cart-link"]');
    this.cartBadge = page.locator('[data-test="shopping-cart-badge"]');
  }

  /** Add a product by its display name, e.g. "Sauce Labs Backpack". */
  async addToCart(productName) {
    const slug = productName.toLowerCase().replace(/\s+/g, "-");
    await this.page.locator(`[data-test="add-to-cart-${slug}"]`).click();
  }

  async openCart() {
    await this.cartLink.click();
  }
}
