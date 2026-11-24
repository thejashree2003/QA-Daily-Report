// AAQA-1 – Login and Cart Review. Each test title carries its Jira Test key.
import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { InventoryPage } from "../pages/InventoryPage.js";
import { CartPage } from "../pages/CartPage.js";

const USER = process.env.SAUCE_USERNAME || "standard_user";
const PASSWORD = process.env.SAUCE_PASSWORD; // never hard-coded
const BACKPACK = "Sauce Labs Backpack";
const BIKE_LIGHT = "Sauce Labs Bike Light";
const TSHIRT = "Sauce Labs Bolt T-Shirt";

const needsPassword = () =>
  test.skip(!PASSWORD, "SAUCE_PASSWORD environment variable is not set");

async function loginAsStandardUser(page) {
  const login = new LoginPage(page);
  await login.open();
  await login.login(USER, PASSWORD);
  await expect(page).toHaveURL(/inventory\.html/);
  return new InventoryPage(page);
}

test.describe("AAQA-1 Login", () => {
  test("AAQA-16 TC-01: valid user can log in and reach the Products page", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await expect(inventory.title).toHaveText("Products");
  });

  test("AAQA-17 TC-02: wrong password is rejected", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.login(USER, "wrong_password");
    await expect(login.error).toContainText("Username and password do not match any user in this service");
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test("AAQA-18 TC-03: empty username is rejected", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.password.fill("any_value");
    await login.loginButton.click();
    await expect(login.error).toContainText("Username is required");
  });

  test("AAQA-19 TC-04: empty password is rejected", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.username.fill(USER);
    await login.loginButton.click();
    await expect(login.error).toContainText("Password is required");
  });

  test("AAQA-20 TC-05: locked-out user cannot log in", async ({ page }) => {
    needsPassword();
    const login = new LoginPage(page);
    await login.open();
    await login.login("locked_out_user", PASSWORD);
    await expect(login.error).toContainText("this user has been locked out");
    await expect(page).not.toHaveURL(/inventory\.html/);
  });
});

test.describe("AAQA-1 Cart review (AC1)", () => {
  test("AAQA-21 TC-06: cart shows item name, description, price and quantity", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await inventory.addToCart(BACKPACK);
    await expect(inventory.cartBadge).toHaveText("1");
    await inventory.openCart();
    const cart = new CartPage(page);
    const row = cart.itemByName(BACKPACK);
    await expect(row.locator('[data-test="inventory-item-name"]')).toHaveText(BACKPACK);
    await expect(row.locator('[data-test="inventory-item-desc"]')).not.toBeEmpty();
    await expect(row.locator('[data-test="inventory-item-price"]')).toHaveText("$29.99");
    await expect(row.locator('[data-test="item-quantity"]')).toHaveText("1");
  });

  test("AAQA-22 TC-07: cart page displays the total price calculation", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await inventory.addToCart(BACKPACK);
    await inventory.addToCart(BIKE_LIGHT);
    await inventory.openCart();
    // AC1: "I should see the total price calculation" on the cart page (expected $39.98).
    await expect(page.getByText(/total/i).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("39.98")).toBeVisible({ timeout: 3000 });
  });

  test("AAQA-23 TC-08: Continue Shopping returns to the Products page", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await inventory.addToCart(BACKPACK);
    await inventory.openCart();
    const cart = new CartPage(page);
    await cart.continueShopping.click();
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(inventory.cartBadge).toHaveText("1");
  });

  test("AAQA-24 TC-09: Checkout proceeds to checkout step one", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await inventory.addToCart(BACKPACK);
    await inventory.openCart();
    await new CartPage(page).checkout.click();
    await expect(page).toHaveURL(/checkout-step-one\.html/);
  });

  test("AAQA-25 TC-10: cart lists multiple items and badge count matches", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    for (const name of [BACKPACK, BIKE_LIGHT, TSHIRT]) await inventory.addToCart(name);
    await expect(inventory.cartBadge).toHaveText("3");
    await inventory.openCart();
    const cart = new CartPage(page);
    await expect(cart.items).toHaveCount(3);
    await expect(page.locator('[data-test="item-quantity"]')).toHaveText(["1", "1", "1"]);
  });

  test("AAQA-26 TC-11: empty cart shows no items but keeps navigation options", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await inventory.openCart();
    const cart = new CartPage(page);
    await expect(cart.items).toHaveCount(0);
    await expect(cart.cartBadge).toHaveCount(0);
    await expect(cart.continueShopping).toBeVisible();
    await expect(cart.checkout).toBeVisible();
  });

  test("AAQA-27 TC-12: removing an item updates the cart list and badge", async ({ page }) => {
    needsPassword();
    const inventory = await loginAsStandardUser(page);
    await inventory.addToCart(BACKPACK);
    await inventory.addToCart(BIKE_LIGHT);
    await inventory.openCart();
    const cart = new CartPage(page);
    await cart.remove(BACKPACK);
    await expect(cart.items).toHaveCount(1);
    await expect(cart.itemByName(BIKE_LIGHT)).toBeVisible();
    await expect(cart.cartBadge).toHaveText("1");
  });
});

test.describe("AAQA-1 Security", () => {
  test("AAQA-28 TC-13: unauthenticated direct access to the cart is denied", async ({ page }) => {
    await page.goto("/cart.html");
    const login = new LoginPage(page);
    await expect(login.loginButton).toBeVisible();
    await expect(login.error).toContainText("when you are logged in");
  });

  test("AAQA-29 TC-14: password field masks its input", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.password.fill("some_text");
    await expect(login.password).toHaveAttribute("type", "password");
  });
});
