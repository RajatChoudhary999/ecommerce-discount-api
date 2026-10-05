# Architectural & Engineering Decisions (DECISIONS.md)

This document details the architectural, transactional, and business logic decisions made during the implementation of the **Ecommerce Discount & Reliable Checkout API**.

---

## 1. System Invariants

The service is engineered to strictly preserve the following 14 core invariants under sequential, concurrent, and retried operations:

1. **Inventory Non-Negativity:** Available product inventory must never drop below zero.
2. **No Overselling:** Concurrent checkout requests competing for limited stock must never oversell available inventory.
3. **Single Checkout per Cart:** A cart instance cannot successfully check out more than once.
4. **Idempotent Checkout Retries:** Retrying the same checkout request (via idempotency key) must return the existing order without creating a duplicate order.
5. **No Double-Deduction:** Inventory must not be deducted twice due to a retried checkout request.
6. **Immutable Historical Snapshot:** Placed orders retain frozen snapshots of product names, unit prices, purchased quantities, line totals, and discount records, remaining completely unaffected by subsequent catalog changes.
7. **Safe Money Calculations:** All monetary arithmetic avoids floating-point inaccuracies through integer/cents calculation and deterministic rounding (`Math.round`), ensuring non-negative totals.
8. **Eligible Milestone Coupons Only:** A coupon can only be generated when an order milestone ($n, 2n, 3n, \dots$) has been reached and that milestone has not already been rewarded.
9. **Single Coupon Redemption:** A discount coupon can only be redeemed once.
10. **Mutual Exclusion on Coupon Redemption:** Concurrent checkouts attempting to redeem the exact same coupon cannot both succeed; exactly one succeeds and the other is rejected.
11. **Non-Consumptive Checkout Failure:** If checkout fails (e.g., due to stock depletion on another item), any supplied coupon is not consumed and remains fully available.
12. **Non-Negative Order Totals:** Discounts can never reduce the order final amount below zero (`finalAmount >= 0`).
13. **Reconciled Admin Reporting:** Administrative reporting summaries are computed strictly from persisted order records and coupons, maintaining 100% mathematical reconciliation.
14. **Read-Only Reporting:** Repeated administrative report requests are purely read-only and never mutate system state.

---

## 2. Ambiguities Found and Selected Semantics

### Ambiguity 1: Automatic vs. Explicit Administrative Coupon Generation
- **Context:** The prompt notes that "every $n$th order makes a discount coupon available" and specifies administrative operations to "Generate a coupon when an unrewarded milestone is eligible."
- **Selected Semantics:** Placing the $n$th order marks an unrewarded milestone as eligible. The generation of the coupon code itself is triggered via the administrative endpoint (`POST /api/admin/generate-coupon`). If an admin attempts to generate a coupon before reaching the milestone or when all eligible milestones have already been rewarded, the request is rejected with HTTP `400 Bad Request`. When a coupon is generated, it becomes active and available for customer checkout redemption.

### Ambiguity 2: Cart Price Changes vs. Checkout Timing
- **Context:** What happens when a product price changes between the time an item was added to the cart and the time checkout is initiated?
- **Selected Semantics:** Viewing the cart (`GET /api/cart/:userId`) dynamically evaluates current catalog prices and inventory. At checkout, the system validates and snapshots the exact catalog price in real-time under a transactional lock. This prevents "stale price locking" or negative margin attacks.

### Ambiguity 3: User-Level vs. Cart-Level Identification
- **Context:** The starter code mapped carts by `userId`, while requirements state that "A cart cannot successfully checkout more than once."
- **Selected Semantics:** Carts are assigned unique `cartId` identifiers and a state (`ACTIVE` vs. `CHECKED_OUT`). The `userId` maps to their current `ACTIVE` cart. Upon successful checkout, the cart transitions to `CHECKED_OUT` and is archived in `cartsById` while being cleared from the user's active slot. Any checkout request on a cart already marked `CHECKED_OUT` is rejected with HTTP `409 Conflict`.

---

## 3. Material Design Decisions

### Decision 1: Concurrency Control via Queue-Based Async Mutex Lock

**Context:** Node.js executes JavaScript on a single thread, but asynchronous I/O and concurrent HTTP requests interleave across event loop ticks. If two concurrent checkout requests inspect inventory before either decrements it, stock overselling occurs. Similarly, concurrent requests could both redeem the same coupon.

**Options considered:**
1. *Optimistic Concurrency Control (OCC) with Retry Loop:* Validate inventory, attempt CAS (compare-and-swap), and retry if conflicts occur.
2. *Fine-Grained Key-Based Resource Locking:* Lock only the individual product IDs and coupon code touched by the request.
3. *Serialized Transaction Mutex (`AsyncLock`):* Queue checkout operations sequentially using an in-memory promise chain.

**Choice:** We implemented a serialized transaction mutex (`AsyncLock`) for the checkout pipeline.

**Why:** In an in-memory architecture, queueing checkout transactions is minimal overhead, eliminates distributed deadlocks, and guarantees 100% deterministic atomicity across inventory validation, coupon redemption, cart status updates, and order generation.

**Consequences:** Checkout requests execute sequentially without race conditions. Under extreme multi-process workloads, this would migrate to Redis distributed locks (Redlock) or SQL row-level locks (`SELECT ... FOR UPDATE`).

---

### Decision 2: Real-Time Catalog Revalidation vs. Pre-Allocation Cart Reservations

**Context:** When a customer adds an item to their cart, should that item's inventory be immediately deducted/reserved from catalog stock, or should inventory deduction occur exclusively at checkout?

**Options considered:**
1. *Cart-Level Inventory Reservation with TTL:* Decrement catalog inventory upon adding to cart, with a background timer (e.g., 15 minutes) to release abandoned reservations.
2. *Just-in-Time Checkout Allocation:* Verify catalog inventory availability when items enter the cart (as a UX hint), but perform actual inventory deduction and authoritative verification atomically at checkout.

**Choice:** Just-in-Time Checkout Allocation with real-time catalog revalidation.

**Why:** Cart-level reservations introduce high complexity (abandoned carts locking stock from purchasing customers, TTL cleanup race conditions, and denial-of-inventory vectors). Checking availability on cart addition provides immediate feedback, while authoritative atomic deduction at checkout ensures only paid orders claim inventory.

**Consequences:** If another customer buys out the limited stock while a user is browsing, the subsequent checkout gracefully fails with HTTP `409 Conflict` ("Insufficient inventory") without corrupting system state.

---

### Decision 3: Idempotency Key Handling with Response Caching

**Context:** Network timeouts, transient client drops, or repeated user button clicks can cause identical checkout requests to be retried. The system must not create multiple orders or deduct inventory twice.

**Options considered:**
1. *Natural Deduplication on Cart State:* Rely strictly on checking whether `cart.status === 'CHECKED_OUT'`.
2. *Client-Supplied Idempotency Key Store:* Support an `Idempotency-Key` header (or `idempotencyKey` body parameter) mapped to cached response payloads.

**Choice:** Client-Supplied Idempotency Key Store combined with Cart State Protection.

**Why:** Natural cart checks cannot differentiate between a legitimate network retry of a timed-out request (which should return the placed order with HTTP 200/201) and an unintended second checkout attempt (which should be rejected with 409). Storing the outcome of an idempotency key allows retries to return the identical order snapshot safely without executing business logic or touching inventory.

**Consequences:** API clients can safely retry checkouts. If no idempotency key is supplied and a user attempts to reuse a completed cart, the cart status check prevents duplicate orders.

---

### Decision 4: Immutable Historical Order Snapshots

**Context:** Products change over time—prices fluctuate and names get updated. An order must remain an indisputable record of what was purchased and the exact amount charged.

**Options considered:**
1. *Foreign Key References:* Store only `{ productId, qty }` in orders and resolve names and prices dynamically on fetch.
2. *Denormalized Historical Snapshot:* Snapshot the product name, unit price, quantity, line total, applied discount code, discount percent, and final total at the instant of order creation.

**Choice:** Denormalized Historical Snapshot.

**Why:** Resolving product details dynamically fails historical audits whenever prices or product names are updated in the catalog.

**Consequences:** Order retrieval (`GET /api/checkout/:orderId`) always produces immutable historical data, verified by automated unit tests.

---

### Decision 5: Deterministic Integer & Cents-Based Money Math

**Context:** Standard IEEE 754 floating-point numbers in JavaScript suffer from binary rounding errors (e.g., `0.1 + 0.2 !== 0.3` or `19.99 * 3 = 59.970000000000006`).

**Options considered:**
1. *External Decimal Libraries (`decimal.js` or `bignumber.js`):* Heavyweight external dependencies.
2. *Integer Cents Math with Explicit Rounding (`Math.round`):* Represent currency units as integers or round fractional discount calculations half-up (`Math.round((subtotal * discountPercent) / 100)`).

**Choice:** Integer cents arithmetic and deterministic `Math.round` rounding, clamped to avoid negative amounts.

**Why:** Avoids introducing heavy external dependencies while guaranteeing deterministic, drift-free financial calculations. Discounts are strictly capped so that `finalAmount = Math.max(0, totalAmount - discountApplied)`.

**Consequences:** Order totals and discount amounts remain integers or exact 2-decimal rounded values without floating-point artifacts.

---

## 4. Transaction, Concurrency, and Idempotency Strategy

```
[ Incoming Checkout Request ]
             |
             v
+-------------------------------+
| Check Idempotency Store       | ---- (Hit) ----> Return Cached Order (201 OK)
+-------------------------------+
             | (Miss)
             v
+-------------------------------+
| Acquire Async Transaction Lock|
+-------------------------------+
             |
             +---> Validate Cart (exists, items > 0, status == 'ACTIVE')
             |
             +---> Validate Live Inventory (product.inventory >= item.qty)
             |
             +---> Validate Coupon (if provided: exists & status == 'AVAILABLE')
             |
             +---> Compute Line Totals, Subtotal, Discount & Final Amount
             |
             +---> [Atomic Mutation]
             |       - Deduct product inventories
             |       - Mark coupon status = 'REDEEMED'
             |       - Mark cart status = 'CHECKED_OUT'
             |       - Append Order to historical log
             |       - Update metrics (orderCount, totalDiscountAmount)
             |       - Cache Idempotency response
             |
             v
+-------------------------------+
| Release Async Transaction Lock|
+-------------------------------+
             |
             v
  Return New Order (201 Created)
```

- **Rollback on Error:** If any validation fails (e.g., insufficient stock or invalid coupon) or an unexpected error throws prior to commit, execution aborts immediately without modifying inventory, cart status, or coupon status.

---

## 5. Error Model

The API employs standard HTTP status codes with informative, machine-readable JSON error payloads:

| Status Code | Meaning | Example Trigger |
| :--- | :--- | :--- |
| `200 OK` | Success | Cart retrieved, item updated, stats retrieved |
| `201 Created` | Resource Created | Order successfully placed, coupon generated |
| `400 Bad Request` | Validation Failure | Invalid quantity, missing fields, milestone not eligible, expired coupon |
| `404 Not Found` | Resource Missing | Non-existent product ID, non-existent order ID |
| `409 Conflict` | State Conflict | Insufficient inventory, cart already checked out |
| `500 Server Error` | Unexpected Error | Uncaught exception (with development stack trace) |

Payload contract:
```json
{
  "message": "Human-readable explanation of error",
  "productId": 5 // optional contextual identifier
}
```

---

## 6. Implemented vs. Intentionally Deferred Items

### Implemented
- Full Cart CRUD (`create`, `add`, `update`, `remove`, `get`) with live product enrichment and inventory checks.
- Serialized, atomic checkout with inventory deduction, coupon redemption, and idempotency protection.
- Immutable historical order snapshot with dedicated order retrieval endpoint (`GET /api/checkout/:orderId`).
- Milestone-based coupon generation logic ($n=5, x=10\%$) with eligibility checks.
- Single-use coupon lifecycle (`AVAILABLE` $\to$ `REDEEMED`) with mutual exclusion and rollback on checkout failure.
- Comprehensive read-only administrative reporting reconciling orders, revenue, discounts, and product quantities.
- 22 automated unit/integration tests covering all concurrency, idempotency, snapshot, and milestone behaviors.

### Intentionally Deferred
- **Persistent SQL Database Integration:** Although `sequelize` and `pg` exist in `package.json`, an in-memory data store was specified and preserved. Deferred migrations and connection pool tuning.
- **Distributed Caching & Redis Locking:** For single-instance execution, in-memory `AsyncLock` is sufficient. Distributed locks were deferred.
- **Authentication & Role-Based Authorization:** Deferred per requirements ("Authentication is not required. Clearly identify which operations you treat as administrative").
- **Payment Gateway Integration:** As instructed, successful checkout is treated as immediate payment success.

---

## 7. Evolution to Multi-Instance Production Scale

To scale this service across a distributed Kubernetes cluster or serverless instances:

1. **Database Persistence:** Replace `store/db.js` with PostgreSQL utilizing ACID transactions.
   - Checkout uses `SELECT ... FOR UPDATE` on product rows to lock inventory atomically during order creation.
2. **Distributed Locks / Redis:** For coupon redemption and idempotency locks across instances, use Redis with Redlock or atomic Redis `SET NX EX`.
3. **Idempotency Persistence:** Store idempotency keys in a high-speed Redis key-value store with a 24-hour TTL.
4. **Outbox Pattern for Events:** Emit `OrderPlacedEvent` and `CouponGeneratedEvent` through Kafka or RabbitMQ to decouple analytics, email notifications, and reporting.
5. **Read Replica for Reporting:** Offload administrative reports (`/api/admin/stats`) to a read-replica database or OLAP warehouse (ClickHouse/BigQuery) to avoid contention with checkout transactions.

---

## 8. AI Usage & Material Corrections

AI assistance was utilized during the development of this submission for code generation, test scaffolding, and edge-case discovery. In accordance with requirements, all output was rigorously reviewed and validated.

### Concrete Example of Material Correction:
- **Issue with In-Memory Array References:** During test scaffolding, the initial implementation of the store reset utility (`resetStore()`) re-instantiated the products array (`products = INITIAL_PRODUCTS.map(...)`). However, because CommonJS `require()` destructures exported objects once upon module evaluation, controller modules retained references to the original array instance where stock was already depleted. This caused later test suites to fail with unexpected stock depletion errors.
- **Correction Applied:** We rejected the array reassignment and redirected the reset strategy to perform in-place mutations (`products.length = 0; INITIAL_PRODUCTS.forEach(p => products.push({ ...p }));`). This ensured that all imported references in controllers remained valid and synchronized across test runs without reference leakage.
- **Correction in Coupon Milestone Triggering:** An initial AI template kept coupon generation coupled directly inside the checkout handler. We redirected the architecture to enforce the explicit requirement that administrators trigger coupon generation for unrewarded milestones, while ensuring that checkout safely returns available codes.

---

## 9. If Another Two Hours Were Available

If an additional two hours were available, the following areas would be prioritized:
1. **PostgreSQL / Sequelize Database Migration:** Wire up the existing Sequelize configuration to run on an embedded SQLite or PostgreSQL container, demonstrating row-level locking (`transaction.LOCK.UPDATE`).
2. **Rate Limiting & Abuse Prevention:** Add Express rate limiters (`express-rate-limit`) on checkout and coupon redemption endpoints.
3. **OpenAPI / Swagger Documentation:** Generate an interactive Swagger UI for testing endpoints directly in the browser.
4. **Webhook / Event Notifications:** Add a webhook dispatcher to notify third-party fulfillment services when an order is finalized.
