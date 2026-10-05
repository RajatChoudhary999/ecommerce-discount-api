# Reliable Ecommerce Checkout & Discount Rewards Service

A robust Node.js / Express backend service implementing an ecommerce cart, concurrent-safe checkout, order snapshot history, and milestone-based discount rewards.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [System Architecture & Invariants](#system-architecture--invariants)
- [Setup & Run Instructions](#setup--run-instructions)
- [Seed Data](#seed-data)
- [API Reference](#api-reference)
  - [Cart APIs](#cart-apis)
  - [Checkout & Order APIs](#checkout--order-apis)
  - [Administrative APIs](#administrative-apis)
- [Automated Testing](#automated-testing)
- [Architectural Decisions](#architectural-decisions)

---

## Overview

This service manages customer shopping carts, inventory enforcement, atomic checkout transactions, and an order-milestone reward system:
- **Milestone Rewards:** Every $n$th successfully placed order ($n=5$ by default, configurable) unlocks eligibility for an administrator to generate a $x\%$ discount coupon ($x=10\%$ by default).
- **Concurrency & Invariants:** Protected against race conditions, stock overselling, duplicate redemptions, and floating-point financial drift.
- **Idempotency:** Protects against duplicate orders or double inventory deductions upon retried client requests.

---

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js
- **Persistence:** In-Memory transactional store with Mutex lock
- **Testing:** Jest & Supertest

---

## System Architecture & Invariants

1. **Inventory Non-Negativity:** Stock never drops below zero.
2. **Atomic Checkout Mutex:** Concurrent checkouts competing for limited inventory cannot oversell stock.
3. **Cart Single-Checkout:** A cart cannot be checked out more than once.
4. **Idempotency Protection:** Retrying the same checkout request with an idempotency key safely returns the placed order without creating another order or deducting stock again.
5. **Historical Snapshot:** Orders permanently preserve the product details, prices, and quantities from the time of checkout.
6. **Coupon Single-Use:** A coupon can only be redeemed once and cannot be redeemed concurrently by competing checkouts.
7. **Coupon Rollback on Failure:** A failed checkout (e.g., due to stock depletion) does not consume the coupon.
8. **Reconciled Admin Reporting:** Reporting summaries calculate directly from persisted orders and coupons, with repeated requests mutating zero state.

---

## Setup & Run Instructions

### Prerequisites
- Node.js (v16.x or higher)
- npm (v8.x or higher)

### Installation
From the repository root or backend directory:

```bash
cd backend
npm install
```

### Environment Configuration (Optional)
The service operates with zero external dependencies out-of-the-box. Optional configuration in `backend/.env`:

```env
PORT=5000
NTH_ORDER=5
DISCOUNT_PERCENT=10
```

### Starting the Server

```bash
# Production start
npm start

# Development mode with hot-reloading
npm run dev
```

The server will start listening at: `http://localhost:5000`

---

## Seed Data

The catalog comes pre-seeded with 5 products, including items with limited stock:

| Product ID | Name | Unit Price (cents / units) | Available Inventory | Stock Notes |
| :--- | :--- | :--- | :--- | :--- |
| `1` | Shirt | 1000 | 10 | Standard stock |
| `2` | Shoes | 3000 | 5 | Standard stock |
| `3` | Watch | 5000 | 2 | **Limited stock** (used in concurrency tests) |
| `4` | Book | 500 | 20 | High volume stock |
| `5` | Headphones | 2000 | 1 | **Very limited stock** (single unit) |

---

## API Reference

### Cart APIs

#### 1. Create or Initialize Cart
- **Method:** `POST`
- **Path:** `/api/cart`
- **Request Body:**
  ```json
  {
    "userId": "user123"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "message": "Cart ready",
    "cart": {
      "id": "cart_1_1770000000000",
      "userId": "user123",
      "items": [],
      "status": "ACTIVE",
      "createdAt": "2026-10-05T14:20:00.000Z"
    }
  }
  ```

#### 2. Add Item to Cart
- **Method:** `POST`
- **Path:** `/api/cart/add`
- **Request Body:**
  ```json
  {
    "userId": "user123",
    "productId": 1,
    "qty": 2
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "message": "Item added to cart",
    "cart": {
      "id": "cart_1_1770000000000",
      "userId": "user123",
      "items": [
        { "productId": 1, "qty": 2 }
      ],
      "status": "ACTIVE"
    }
  }
  ```
- **Error Cases:**
  - `400 Bad Request`: Missing fields, invalid non-positive quantity, or requested quantity exceeds available inventory.
  - `404 Not Found`: Product ID does not exist in catalog.

#### 3. Update Item Quantity in Cart
- **Method:** `PUT`
- **Path:** `/api/cart/update` (also accepts `/api/cart`)
- **Request Body:**
  ```json
  {
    "userId": "user123",
    "productId": 1,
    "qty": 3
  }
  ```
  *(Setting `qty: 0` removes the item from the cart).*
- **Response (`200 OK`):** Updated cart object.

#### 4. View Cart
- **Method:** `GET`
- **Path:** `/api/cart/:userId`
- **Response (`200 OK`):**
  ```json
  {
    "cartId": "cart_1_1770000000000",
    "userId": "user123",
    "status": "ACTIVE",
    "items": [
      {
        "productId": 1,
        "name": "Shirt",
        "price": 1000,
        "availableInventory": 10,
        "qty": 2,
        "total": 2000
      }
    ],
    "totalAmount": 2000
  }
  ```

#### 5. Remove Item from Cart
- **Method:** `DELETE`
- **Path:** `/api/cart/remove`
- **Request Body:**
  ```json
  {
    "userId": "user123",
    "productId": 1
  }
  ```

---

### Checkout & Order APIs

#### 1. Checkout Cart
- **Method:** `POST`
- **Path:** `/api/checkout`
- **Headers (Optional):** `Idempotency-Key: <unique-string>`
- **Request Body:**
  ```json
  {
    "userId": "user123",
    "discountCode": "SAVE10-A1B2C3",
    "idempotencyKey": "req-xyz-123"
  }
  ```
- **Response (`201 Created`):**
  ```json
  {
    "message": "Order placed successfully",
    "order": {
      "orderId": 1,
      "userId": "user123",
      "cartId": "cart_1_1770000000000",
      "items": [
        {
          "productId": 1,
          "name": "Shirt",
          "price": 1000,
          "qty": 2,
          "total": 2000
        }
      ],
      "totalAmount": 2000,
      "discountCode": "SAVE10-A1B2C3",
      "discountPercent": 10,
      "discountApplied": 200,
      "finalAmount": 1800,
      "createdAt": "2026-10-05T14:25:00.000Z"
    },
    "activeDiscountCode": null
  }
  ```
- **Idempotent Replay Response (`201 Created`):**
  When re-submitting with the same `idempotencyKey`:
  ```json
  {
    "message": "Order placed successfully",
    "order": { ... },
    "idempotentReplay": true
  }
  ```
- **Error Cases:**
  - `400 Bad Request`: Cart is empty, missing `userId`, or invalid/already redeemed discount code.
  - `409 Conflict`: Insufficient product stock to fulfill order, or cart has already been checked out.

#### 2. Retrieve Historical Order
- **Method:** `GET`
- **Path:** `/api/checkout/:orderId` (or `/api/checkout/order/:orderId`)
- **Response (`200 OK`):**
  ```json
  {
    "order": {
      "orderId": 1,
      "userId": "user123",
      "items": [ ... ],
      "totalAmount": 2000,
      "discountApplied": 200,
      "finalAmount": 1800,
      "createdAt": "2026-10-05T14:25:00.000Z"
    }
  }
  ```
- **Error Cases:**
  - `404 Not Found`: Order ID does not exist.

---

### Administrative APIs

#### 1. Generate Milestone Coupon
- **Method:** `POST`
- **Path:** `/api/admin/generate-coupon` (also accepts `/api/admin/coupon`)
- **Response (`201 Created`):**
  ```json
  {
    "message": "Coupon generated successfully",
    "coupon": {
      "code": "SAVE10-9F3B2C",
      "discountPercent": 10,
      "milestoneOrder": 5,
      "status": "AVAILABLE",
      "createdAt": "2026-10-05T14:30:00.000Z",
      "redeemedAt": null,
      "redeemedInOrderId": null
    }
  }
  ```
- **Error Cases:**
  - `400 Bad Request`: Unrewarded milestone not yet eligible (e.g., fewer than 5 orders placed or current milestone already rewarded).

#### 2. View Active Discount Code
- **Method:** `GET`
- **Path:** `/api/admin/discount-code`
- **Response (`200 OK`):**
  ```json
  {
    "message": "Discount code available",
    "code": "SAVE10-9F3B2C",
    "discountPercent": 10
  }
  ```

#### 3. Administrative Reporting Summary
- **Method:** `GET`
- **Path:** `/api/admin/stats`
- **Response (`200 OK`):**
  ```json
  {
    "totalOrders": 6,
    "totalItemsPurchased": 11,
    "purchasedQuantityByProduct": {
      "1": 1,
      "2": 0,
      "3": 0,
      "4": 10,
      "5": 0
    },
    "productSales": [
      { "productId": 1, "name": "Shirt", "quantity": 1 },
      { "productId": 2, "name": "Shoes", "quantity": 0 },
      { "productId": 3, "name": "Watch", "quantity": 0 },
      { "productId": 4, "name": "Book", "quantity": 10 },
      { "productId": 5, "name": "Headphones", "quantity": 0 }
    ],
    "grossRevenue": 6000,
    "totalDiscountsGranted": 100,
    "netRevenue": 5900,
    "coupons": {
      "generated": 1,
      "available": 0,
      "redeemed": 1
    },
    "issuedDiscountCodes": ["SAVE10-9F3B2C"],
    "totalPurchaseAmount": 5900,
    "totalDiscountAmount": 100,
    "activeCode": null
  }
  ```
- **Properties:**
  - Fully reconciles with all placed orders and issued coupons.
  - Read-only; repeated calls will never mutate state.

---

## Automated Testing

The automated test suite runs via Jest and Supertest, comprehensively exercising business rules, concurrency limits, and failure modes.

### Running Tests

```bash
cd backend
npm test
```

### Test Coverage Highlights

- `tests/cart.test.js`:
  - Cart addition, positive integer quantity validation, invalid product rejection.
  - Inventory availability validation on adding/updating cart items.
  - Quantity updates, zero-quantity item removal, and item deletion.
  - View cart with enriched product details and subtotal calculations.
- `tests/checkout.test.js`:
  - Successful checkout and inventory deduction.
  - Insufficient stock checkout rejection (preserving stock and orders).
  - Single checkout per cart enforcement.
  - Idempotent request replay preventing duplicate orders or deductions.
  - Concurrent checkouts competing for limited inventory (`Promise.all`), preventing overselling.
  - Immutable historical order snapshot preserving original prices after catalog updates.
  - Deterministic money rounding and non-negative total enforcement.
- `tests/coupon.test.js`:
  - Milestone threshold enforcement (rejecting coupon generation before 5 orders).
  - Milestone coupon generation upon reaching 5 orders.
  - Duplicate coupon generation rejection for already-rewarded milestones.
  - Coupon redemption applying 10% discount.
  - Prevention of double-redemption (single-use enforcement).
  - Concurrent checkouts competing for the same coupon (exactly one wins).
  - Non-consumptive checkout failure (coupon remains `AVAILABLE` when checkout fails).
- `tests/admin.test.js`:
  - Statistical reporting summary reconciliation with orders and coupons.
  - Purely read-only, idempotent reporting verification.

---

## Architectural Decisions

For deep dives into design rationale, transaction concurrency patterns, money handling, and multi-instance evolution, please see [DECISIONS.md](./DECISIONS.md).
