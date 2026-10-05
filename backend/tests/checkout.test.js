const request = require("supertest");
const app = require("../server");
const { resetStore, products, orders } = require("../store/db");

describe("Checkout API", () => {
  beforeEach(() => {
    resetStore();
  });

  it("should successfully checkout and create an order", async () => {
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user1", productId: 1, qty: 2 }); // Shirt: 1000 * 2 = 2000

    const initialInventory = products.find((p) => p.id === 1).inventory;

    const res = await request(app)
      .post("/api/checkout")
      .send({ userId: "user1" });

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe("Order placed successfully");
    expect(res.body.order.orderId).toBe(1);
    expect(res.body.order.totalAmount).toBe(2000);
    expect(res.body.order.finalAmount).toBe(2000);
    expect(res.body.order.items.length).toBe(1);

    // Verify inventory deduction
    const updatedInventory = products.find((p) => p.id === 1).inventory;
    expect(updatedInventory).toBe(initialInventory - 2);

    // Verify cart is now empty
    const cartRes = await request(app).get("/api/cart/user1");
    expect(cartRes.body.items.length).toBe(0);
  });

  it("should fail checkout when requested quantity exceeds available inventory", async () => {
    // Product 5 (Headphones) has inventory: 1
    const p5 = products.find((p) => p.id === 5);
    expect(p5.inventory).toBe(1);

    // Add item to cart
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_inv", productId: 5, qty: 1 });

    // Manually reduce inventory to 0 simulating inventory running out before checkout
    p5.inventory = 0;

    const res = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_inv" });

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("Insufficient inventory");

    // Inventory must not be negative
    expect(p5.inventory).toBe(0);
    expect(orders.length).toBe(0);
  });

  it("should prevent a cart from successfully checking out more than once", async () => {
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_dup", productId: 1, qty: 1 });

    const firstRes = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_dup" });

    expect(firstRes.statusCode).toBe(201);

    // Attempting to checkout again immediately
    const secondRes = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_dup" });

    expect(secondRes.statusCode).toBe(400);
    expect(secondRes.body.message).toBe("Cart is empty");
  });

  it("should handle retries idempotently without creating another order or deducting inventory twice", async () => {
    const idempotencyKey = "unique-client-key-12345";
    const p1 = products.find((p) => p.id === 1);
    const startInventory = p1.inventory;

    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_retry", productId: 1, qty: 2 });

    // Initial checkout attempt
    const res1 = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_retry", idempotencyKey });

    expect(res1.statusCode).toBe(201);
    expect(orders.length).toBe(1);
    expect(p1.inventory).toBe(startInventory - 2);

    // Retry with the exact same idempotency key
    const res2 = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_retry", idempotencyKey });

    expect(res2.statusCode).toBe(201);
    expect(res2.body.idempotentReplay).toBe(true);
    expect(res2.body.order.orderId).toBe(res1.body.order.orderId);

    // Verify order count and inventory were NOT changed by the retry
    expect(orders.length).toBe(1);
    expect(p1.inventory).toBe(startInventory - 2);
  });

  it("should prevent overselling during concurrent checkout requests", async () => {
    // Product 3 (Watch) has inventory: 2
    const watch = products.find((p) => p.id === 3);
    expect(watch.inventory).toBe(2);

    // Prepare 4 separate users each with 1 Watch in their cart
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `user_concurrent_${i}`, productId: 3, qty: 1 });
    }

    // Launch all 4 checkouts concurrently
    const results = await Promise.all([
      request(app).post("/api/checkout").send({ userId: "user_concurrent_1" }),
      request(app).post("/api/checkout").send({ userId: "user_concurrent_2" }),
      request(app).post("/api/checkout").send({ userId: "user_concurrent_3" }),
      request(app).post("/api/checkout").send({ userId: "user_concurrent_4" }),
    ]);

    const successfulCheckouts = results.filter((r) => r.statusCode === 201);
    const failedCheckouts = results.filter((r) => r.statusCode === 409);

    // Exactly 2 checkouts must succeed because only 2 Watches were in stock
    expect(successfulCheckouts.length).toBe(2);
    expect(failedCheckouts.length).toBe(2);

    // Inventory must be exactly 0, never negative
    expect(watch.inventory).toBe(0);
    expect(orders.length).toBe(2);
  });

  it("should preserve historical order snapshot even if product price or name changes later", async () => {
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_snap", productId: 1, qty: 2 }); // 1000 each

    const res = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_snap" });

    expect(res.statusCode).toBe(201);
    const placedOrder = res.body.order;

    // Simulate product price and name change in the catalog
    const product1 = products.find((p) => p.id === 1);
    product1.price = 9999;
    product1.name = "Luxury Designer Shirt";

    // Retrieve order and verify historical snapshot remains immutable
    const orderRes = await request(app).get(`/api/checkout/${placedOrder.orderId}`);
    expect(orderRes.statusCode).toBe(200);
    expect(orderRes.body.order.items[0].price).toBe(1000);
    expect(orderRes.body.order.items[0].name).toBe("Shirt");
    expect(orderRes.body.order.totalAmount).toBe(2000);
    expect(orderRes.body.order.finalAmount).toBe(2000);
  });

  it("should calculate money without floating-point errors and never allow negative totals", async () => {
    // Add multiple items with odd quantities and verify rounding
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_money", productId: 4, qty: 3 }); // 500 * 3 = 1500

    const res = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_money" });

    expect(res.statusCode).toBe(201);
    expect(res.body.order.totalAmount).toBe(1500);
    expect(res.body.order.finalAmount).toBe(1500);
    expect(Number.isInteger(res.body.order.totalAmount)).toBe(true);
    expect(Number.isInteger(res.body.order.finalAmount)).toBe(true);
    expect(res.body.order.finalAmount).toBeGreaterThanOrEqual(0);
  });
});
