# Extracted Jira User Story: AAQA-7

- **Jira URL:** https://thejashreetheja03.atlassian.net/browse/AAQA-7
- **Project:** Agentic AI QA Automation
- **Issue ID:** 10083
- **Issue Type:** Story
- **Status:** To Do
- **Priority:** Medium
- **Assignee:** Unassigned
- **Reporter:** Thejashree Theja
- **Created:** 2026-11-20T13:21:52.878+0530
- **Updated:** 2026-11-21T18:31:42.971+0530

## Summary

AAQA-7 - User story for E-commerce Product Sorting and Filtering

## Description

```markdown
# User Story 02: E-commerce Product Sorting and Filtering

## 1. Story Title

Product Sorting and Filtering Functionality

## 2. User Story

As a customer, I want to sort and filter products based on different criteria so that I can easily find products that match my preferences and make informed purchasing decisions.

## 3. Application Details

**Application URL:** https://www.saucedemo.com 

**Test Environment:** Web Application

**Test Credentials:**

* Username: standard_user
* Password: Retrieve securely from the configured test environment. Do not hardcode credentials in test scripts.

**Preconditions:**

1. The application must be accessible.
2. The user must be logged in successfully.
3. The Products page must be displayed.
4. Product inventory must be available.

## 4. Acceptance Criteria

### AC1: Product Sorting – Name (A to Z)

**GIVEN** I am logged in and viewing the Products page.

**WHEN** I select "Name (A to Z)" from the sorting dropdown.

**THEN**

* All available products should be displayed in alphabetical ascending order.
* Product names should be arranged from A to Z.
* No products should be missing or duplicated.
* The selected sorting option should be displayed in the dropdown.

### AC2: Product Sorting – Name (Z to A)

**GIVEN** I am viewing the Products page.

**WHEN** I select "Name (Z to A)" from the sorting dropdown.

**THEN**

* All available products should be displayed in reverse alphabetical order.
* Product names should be arranged from Z to A.
* No products should be missing or duplicated.
* The selected sorting option should remain visible.
```

## Attachments

None returned.

## Linked Issues

None returned.

## Comments

No comments returned.
