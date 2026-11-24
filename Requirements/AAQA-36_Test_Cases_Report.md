# AAQA-36 Test Cases – E-commerce Checkout Process

Test Execution: AAQA-52 · App: https://www.saucedemo.com · Credentials: standard_user + password from the story (supplied via `SAUCE_PASSWORD`, never stored)

```gherkin
Feature: E-commerce Checkout Process (AAQA-36)

  Scenario: TC-01 Verify cart shows item name, description, price and quantity
    # Jira: AAQA-37
    # Preconditions:
    # - Logged in as standard_user; cart is empty

    Action: Given I am a logged-in user
    And I have added "Sauce Labs Backpack" to my cart

TestData: Item "Sauce Labs Backpack", price $29.99, quantity 1
    Expected Result: When I navigate to the cart page
    Then I should see the item name "Sauce Labs Backpack", its description, price $29.99 and quantity 1

  Scenario: TC-02 Verify cart page displays the total price calculation
    # Jira: AAQA-38
    # Preconditions:
    # - Logged in as standard_user; cart is empty

    Action: Given I am a logged-in user
    And I have added "Sauce Labs Backpack" and "Sauce Labs Bike Light" to my cart

TestData: Prices $29.99 + $9.99, expected total $39.98
    Expected Result: When I navigate to the cart page
    Then I should see the total price calculation
    And the total should equal $39.98

  Scenario: TC-03 Verify Continue Shopping returns to Products and Checkout is offered
    # Jira: AAQA-39
    # Preconditions:
    # - Logged in as standard_user; one item in the cart

    Action: Given I am on the cart page with "Sauce Labs Backpack" in my cart

TestData: Item "Sauce Labs Backpack"
    Expected Result: When I view the cart page
    Then I should see the "Continue Shopping" and "Checkout" buttons
    And when I click "Continue Shopping" I should be taken to the Products page
    And the cart badge should still show 1

  Scenario: TC-04 Verify Checkout opens the information page with First Name, Last Name and Zip fields
    # Jira: AAQA-40
    # Preconditions:
    # - Logged in as standard_user; one item in the cart

    Action: Given I am on the cart page with "Sauce Labs Backpack" in my cart

TestData: Item "Sauce Labs Backpack"
    Expected Result: When I click the "Checkout" button
    Then I should be redirected to /checkout-step-one.html
    And I should see form fields for First Name, Last Name and Zip/Postal Code

  Scenario: TC-05 Verify empty First Name shows a required error
    # Jira: AAQA-41
    # Preconditions:
    # - Logged in; on the checkout information page

    Action: Given I am on the checkout information page
    And I leave First Name empty

TestData: First Name "", Last Name "Doe", Zip "12345"
    Expected Result: When I click "Continue"
    Then I should see the error "First Name is required"
    And I should remain on the checkout information page

  Scenario: TC-06 Verify empty Last Name shows a required error
    # Jira: AAQA-42
    # Preconditions:
    # - Logged in; on the checkout information page

    Action: Given I am on the checkout information page
    And I leave Last Name empty

TestData: First Name "John", Last Name "", Zip "12345"
    Expected Result: When I click "Continue"
    Then I should see the error "Last Name is required"
    And I should remain on the checkout information page

  Scenario: TC-07 Verify empty Zip/Postal Code shows a required error
    # Jira: AAQA-43
    # Preconditions:
    # - Logged in; on the checkout information page

    Action: Given I am on the checkout information page
    And I leave Zip/Postal Code empty

TestData: First Name "John", Last Name "Doe", Zip ""
    Expected Result: When I click "Continue"
    Then I should see the error "Postal Code is required"
    And I should remain on the checkout information page

  Scenario: TC-08 Verify order overview shows items, payment, shipping, subtotal, tax and total
    # Jira: AAQA-44
    # Preconditions:
    # - Logged in; Backpack and Bike Light in the cart; on the checkout information page

    Action: Given I am on the checkout information page with "Sauce Labs Backpack" and "Sauce Labs Bike Light" in my order
    And I have entered valid checkout information

TestData: First Name "John", Last Name "Doe", Zip "12345"; Item total $39.98, Tax $3.20, Total $43.18
    Expected Result: When I click "Continue"
    Then I should be redirected to /checkout-step-two.html
    And I should see both items in the order summary
    And I should see Payment Information and Shipping Information
    And I should see Item total $39.98, Tax $3.20 and Total $43.18
    And I should see "Cancel" and "Finish" buttons

  Scenario: TC-09 Verify Finish shows the order confirmation and Back Home button
    # Jira: AAQA-45
    # Preconditions:
    # - Logged in; on the checkout overview page with one item

    Action: Given I am on the checkout overview page

TestData: Item "Sauce Labs Backpack"; First Name "John", Last Name "Doe", Zip "12345"
    Expected Result: When I click "Finish"
    Then I should be redirected to /checkout-complete.html
    And I should see the message "Thank you for your order!"
    And I should see a "Back Home" button

  Scenario: TC-10 Verify order confirmation clears the cart and Back Home returns to Products
    # Jira: AAQA-46
    # Preconditions:
    # - Logged in; order just completed

    Action: Given I have completed an order
    And I am on the order confirmation page

TestData: Item "Sauce Labs Backpack"; First Name "John", Last Name "Doe", Zip "12345"
    Expected Result: When I click "Back Home"
    Then I should be taken to the Products page
    And the cart should be empty with no badge shown

  Scenario: TC-11 Verify special characters in checkout fields are rejected
    # Jira: AAQA-47
    # Preconditions:
    # - Logged in; on the checkout information page

    Action: Given I am on the checkout information page
    And I enter special characters in all fields

TestData: First Name "!@#$%^&*", Last Name "<>?{}", Zip "@@@@@"
    Expected Result: When I click "Continue"
    Then I should see an appropriate validation error message
    And I should not be able to proceed to the order overview

  Scenario: TC-12 Verify checkout cannot proceed with an empty cart
    # Jira: AAQA-48
    # Preconditions:
    # - Logged in; cart is empty

    Action: Given I am a logged-in user with an empty cart
    And I am on the cart page

TestData: Cart items: none
    Expected Result: When I click "Checkout"
    Then I should not be taken to the checkout information page
    And I should remain on the cart page

  Scenario: TC-13 Verify Cancel on the information page returns to the cart
    # Jira: AAQA-49
    # Preconditions:
    # - Logged in; one item in the cart; on the checkout information page

    Action: Given I am on the checkout information page with "Sauce Labs Backpack" in my cart

TestData: Item "Sauce Labs Backpack"
    Expected Result: When I click "Cancel"
    Then I should be returned to the cart page
    And "Sauce Labs Backpack" should still be in my cart

  Scenario: TC-14 Verify Cancel on the order overview returns to the cart
    # Jira: AAQA-50
    # Preconditions:
    # - Logged in; one item in the cart; on the checkout overview page

    Action: Given I am on the checkout overview page with "Sauce Labs Backpack" in my order

TestData: Item "Sauce Labs Backpack"; First Name "John", Last Name "Doe", Zip "12345"
    Expected Result: When I click "Cancel"
    Then I should be returned to the cart page (Business Rule 5)
    And "Sauce Labs Backpack" should still be in my cart

  Scenario: TC-15 Verify unauthenticated direct access to checkout is denied
    # Jira: AAQA-51
    # Preconditions:
    # - No active session

    Action: Given I am not logged in

TestData: URL https://www.saucedemo.com/checkout-step-one.html
    Expected Result: When I navigate directly to the checkout information URL
    Then I should be redirected to the login page
    And I should see an error that checkout requires login
```
