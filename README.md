# Ecommerce Cart + Discount Coupon API

Backend API for an ecommerce store where users can add items to a cart and checkout to place orders.  
Every **nth order** generates a **10% discount coupon**, which can be applied once on the next checkout.

## Project Structure

# Ecommerce Cart + Discount Coupon API

Backend API for an ecommerce store where users can add items to a cart and checkout to place orders.  
Every **nth order** generates a **10% discount coupon**, which can be applied once on the next checkout.

---

## Tech Stack

- Node.js
- Express.js
- In-memory data store (no database)

---

## Features Implemented

### Cart APIs

- Add items to cart
- View cart with total amount
- Remove items from cart

### Checkout API

- Places an order successfully
- Validates optional discount code
- Applies 10% discount only when the active coupon is valid

### Discount Coupon Rule

- Every **nth successful order** generates a coupon code
- Only **one active coupon** exists at a time
- Coupon can be used **only once**
- Invalid/expired coupon returns an error

### Admin APIs

- Fetch current active discount code
- View purchase statistics:
  - Total items purchased
  - Total purchase amount
  - Issued discount codes
  - Total discount amount

---

---

## Unit Testing

Basic unit tests are included using:

- **Jest** (test runner)
- **Supertest** (API endpoint testing)

### Run Tests

To execute all test cases:

```bash
npm test
```
