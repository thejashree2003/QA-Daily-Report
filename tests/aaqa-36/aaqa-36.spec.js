// AAQA-36 – E-commerce Checkout Process. Each test title starts with its Jira Test key (used by scripts/xray-sync.mjs).
import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { InventoryPage } from "../pages/InventoryPage.js";
import { CartPage } from "../pages/CartPage.js";
import { CheckoutPage } from "../pages/CheckoutPage.js";

const USER = process.env.SAUCE_USERNAME || "standard_user";
const PASSWORD = process.env.SAUCE_PASSWORD; // never hard-coded
const BACKPACK = "Sauce Labs Backpack";
const BIKE_LIGHT = "Sauce Labs Bike Light";

const needsPassword = () => test.skip(!PASSWORD, "SAUCE_PASSWORD environment variable is not set");

async function loginAndAdd(page, ...products) {
  const login = new LoginPage(page);
  await login.open();
  await login.login(USER, PASSWORD);
  await expect(page).toHaveURL(/inventory\.html/);
  const inventory = new InventoryPage(page);
  for (const p of products) await inventory.addToCart(p);
  return inventory;
}

/** Log in, add products, go cart -> checkout information page. */
async function toInfoPage(page, ...products) {
  const inventory = await loginAndAdd(page, ...products);
  await inventory.openCart();
  await new CartPage(page).checkout.click();
  await expect(page).toHaveURL(/checkout-step-one\.html/);
  return new CheckoutPage(page);
}

/** Log in, add products, fill valid info, reach the overview page. */
async function toOverviewPage(page, ...products) {
  const checkout = await toInfoPage(page, ...products);
  await checkout.fillInfo("John", "Doe", "12345");
  await checkout.continueButton.click();
  await expect(page).toHaveURL(/checkout-step-two\.html/);
  return checkout;
}

test.describe("AAQA-36 AC1 Cart review", () => {
  test("AAQA-37 TC-01: cart shows item name, description, price and quantity", async ({ page }) => {
    needsPassword();
    const inventory = await loginAndAdd(page, BACKPACK);
    await inventory.openCart();
    const row = new CartPage(page).itemByName(BACKPACK);
    await expect(row.locator('[data-test="inventory-item-name"]')).toHaveText(BACKPACK);
    await expect(row.locator('[data-test="inventory-item-desc"]')).not.toBeEmpty();
    await expect(row.locator('[data-test="inventory-item-price"]')).toHaveText("$29.99");
    await expect(row.locator('[data-test="item-quantity"]')).toHaveText("1");
  });

  test("AAQA-38 TC-02: cart page displays the total price calculation", async ({ page }) => {
    needsPassword();
    const inventory = await loginAndAdd(page, BACKPACK, BIKE_LIGHT);
    await inventory.openCart();
    // AC1: "I should see the total price calculation" on the cart page (expected $39.98).
    await expect(page.getByText(/total/i).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("39.98")).toBeVisible({ timeout: 3000 });
  });

  test("AAQA-39 TC-03: Continue Shopping returns to Products and Checkout is offered", async ({ page }) => {
    needsPassword();
    const inventory = await loginAndAdd(page, BACKPACK);
    await inventory.openCart();
    const cart = new CartPage(page);
    await expect(cart.checkout).toBeVisible();
    await expect(cart.continueShopping).toBeVisible();
    await cart.continueShopping.click();
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(inventory.cartBadge).toHaveText("1");
  });
});

test.describe("AAQA-36 AC2 Checkout information", () => {
  test("AAQA-40 TC-04: Checkout opens the information page with all fields", async ({ page }) => {
    needsPassword();
    const checkout = await toInfoPage(page, BACKPACK);
    await expect(checkout.firstName).toBeVisible();
    await expect(checkout.lastName).toBeVisible();
    await expect(checkout.postalCode).toBeVisible();
  });

  test("AAQA-41 TC-05: empty First Name shows a required error", async ({ page }) => {
    needsPassword();
    const checkout = await toInfoPage(page, BACKPACK);
    await checkout.fillInfo("", "Doe", "12345");
    await checkout.continueButton.click();
    await expect(checkout.error).toContainText("First Name is required");
    await expect(page).toHaveURL(/checkout-step-one\.html/);
  });

  test("AAQA-42 TC-06: empty Last Name shows a required error", async ({ page }) => {
    needsPassword();
    const checkout = await toInfoPage(page, BACKPACK);
    await checkout.fillInfo("John", "", "12345");
    await checkout.continueButton.click();
    await expect(checkout.error).toContainText("Last Name is required");
    await expect(page).toHaveURL(/checkout-step-one\.html/);
  });

  test("AAQA-43 TC-07: empty Zip/Postal Code shows a required error", async ({ page }) => {
    needsPassword();
    const checkout = await toInfoPage(page, BACKPACK);
    await checkout.fillInfo("John", "Doe", "");
    await checkout.continueButton.click();
    await expect(checkout.error).toContainText("Postal Code is required");
    await expect(page).toHaveURL(/checkout-step-one\.html/);
  });
});

test.describe("AAQA-36 AC3 Order overview", () => {
  test("AAQA-44 TC-08: overview shows items, payment, shipping, subtotal, tax and total", async ({ page }) => {
    needsPassword();
    const checkout = await toOverviewPage(page, BACKPACK, BIKE_LIGHT);
    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(2);
    await expect(checkout.paymentInfo).toBeVisible();
    await expect(checkout.shippingInfo).toBeVisible();
    await expect(checkout.subtotal).toContainText("$39.98");
    await expect(checkout.tax).toContainText("$3.20");
    await expect(checkout.total).toContainText("$43.18");
    await expect(checkout.cancelButton).toBeVisible();
    await expect(checkout.finishButton).toBeVisible();
  });

  test("AAQA-50 TC-14: Cancel on the order overview returns to the cart", async ({ page }) => {
    needsPassword();
    const checkout = await toOverviewPage(page, BACKPACK);
    await checkout.cancelButton.click();
    // Business Rule 5: users can cancel checkout at any step and return to cart.
    await expect(page).toHaveURL(/cart\.html/);
    await expect(new CartPage(page).itemByName(BACKPACK)).toBeVisible();
  });
});

test.describe("AAQA-36 AC4 Order completion", () => {
  test("AAQA-45 TC-09: Finish shows the order confirmation and Back Home button", async ({ page }) => {
    needsPassword();
    const checkout = await toOverviewPage(page, BACKPACK);
    await checkout.finishButton.click();
    await expect(page).toHaveURL(/checkout-complete\.html/);
    await expect(checkout.completeHeader).toContainText("Thank you for your order!");
    await expect(checkout.backHome).toBeVisible();
  });

  test("AAQA-46 TC-10: confirmation clears the cart and Back Home returns to Products", async ({ page }) => {
    needsPassword();
    const checkout = await toOverviewPage(page, BACKPACK);
    await checkout.finishButton.click();
    await checkout.backHome.click();
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(new InventoryPage(page).cartBadge).toHaveCount(0);
  });
});

test.describe("AAQA-36 AC5 Error handling and business rules", () => {
  test("AAQA-47 TC-11: special characters in checkout fields are rejected", async ({ page }) => {
    needsPassword();
    const checkout = await toInfoPage(page, BACKPACK);
    await checkout.fillInfo("!@#$%^&*", "<>?{}", "@@@@@");
    await checkout.continueButton.click();
    await expect(checkout.error).toBeVisible({ timeout: 3000 });
    await expect(page).not.toHaveURL(/checkout-step-two\.html/);
  });

  test("AAQA-48 TC-12: checkout cannot proceed with an empty cart", async ({ page }) => {
    needsPassword();
    const inventory = await loginAndAdd(page);
    await inventory.openCart();
    await new CartPage(page).checkout.click();
    // Business Rule 3: cart cannot be empty when proceeding to checkout.
    await expect(page).not.toHaveURL(/checkout-step-one\.html/);
  });

  test("AAQA-49 TC-13: Cancel on the information page returns to the cart", async ({ page }) => {
    needsPassword();
    const checkout = await toInfoPage(page, BACKPACK);
    await checkout.cancelButton.click();
    await expect(page).toHaveURL(/cart\.html/);
    await expect(new CartPage(page).itemByName(BACKPACK)).toBeVisible();
  });

  test("AAQA-51 TC-15: unauthenticated direct access to checkout is denied", async ({ page }) => {
    await page.goto("/checkout-step-one.html");
    const login = new LoginPage(page);
    await expect(login.loginButton).toBeVisible();
    await expect(login.error).toContainText("when you are logged in");
  });
});
