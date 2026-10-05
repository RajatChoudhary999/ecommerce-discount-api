const request = require("supertest");
const app = require("../server");
const { resetStore, products, coupons } = require("../store/db");

describe("Discount Coupons and Milestone Rewards", () => {
  beforeEach(() => {
    resetStore();
  });

  it("should reject coupon generation before order milestone is reached", async () => {
    // Attempt generation with 0 orders placed
    const res = await request(app).post("/api/admin/generate-coupon");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("No unrewarded milestone eligible");
  });

  it("should allow admin to generate coupon once milestone of 5 orders is reached", async () => {
    // Place 5 successful orders
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `user_m_${i}`, productId: 4, qty: 1 }); // Book: 500

      const res = await request(app)
        .post("/api/checkout")
        .send({ userId: `user_m_${i}` });

      expect(res.statusCode).toBe(201);
    }

    // Now milestone 1 (order 5) is eligible
    const genRes = await request(app).post("/api/admin/generate-coupon");
    expect(genRes.statusCode).toBe(201);
    expect(genRes.body.message).toBe("Coupon generated successfully");
    expect(genRes.body.coupon.code).toContain("SAVE10-");
    expect(genRes.body.coupon.discountPercent).toBe(10);
    expect(genRes.body.coupon.status).toBe("AVAILABLE");

    // Attempting to generate again for the same milestone must be rejected
    const dupRes = await request(app).post("/api/admin/generate-coupon");
    expect(dupRes.statusCode).toBe(400);
    expect(dupRes.body.message).toContain("No unrewarded milestone eligible");
  });

  it("should apply discount when valid coupon is provided at checkout and mark it redeemed", async () => {
    // Reach milestone and generate coupon
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `user_c_${i}`, productId: 4, qty: 1 });

      await request(app).post("/api/checkout").send({ userId: `user_c_${i}` });
    }

    const genRes = await request(app).post("/api/admin/generate-coupon");
    const couponCode = genRes.body.coupon.code;

    // Next customer checks out with the coupon
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "customer_with_coupon", productId: 1, qty: 1 }); // Shirt: 1000

    const checkoutRes = await request(app)
      .post("/api/checkout")
      .send({ userId: "customer_with_coupon", discountCode: couponCode });

    expect(checkoutRes.statusCode).toBe(201);
    expect(checkoutRes.body.order.totalAmount).toBe(1000);
    expect(checkoutRes.body.order.discountApplied).toBe(100); // 10% of 1000
    expect(checkoutRes.body.order.finalAmount).toBe(900);
    expect(checkoutRes.body.order.discountCode).toBe(couponCode);

    // Verify coupon is marked REDEEMED
    const couponInStore = coupons.find((c) => c.code === couponCode);
    expect(couponInStore.status).toBe("REDEEMED");
  });

  it("should not allow a coupon to be redeemed twice", async () => {
    // Setup 5 orders and generate coupon
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `u_seq_${i}`, productId: 4, qty: 1 });
      await request(app).post("/api/checkout").send({ userId: `u_seq_${i}` });
    }

    const genRes = await request(app).post("/api/admin/generate-coupon");
    const couponCode = genRes.body.coupon.code;

    // First redemption
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u_first", productId: 1, qty: 1 });

    const firstRes = await request(app)
      .post("/api/checkout")
      .send({ userId: "u_first", discountCode: couponCode });

    expect(firstRes.statusCode).toBe(201);

    // Second redemption attempt with the same coupon code
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u_second", productId: 1, qty: 1 });

    const secondRes = await request(app)
      .post("/api/checkout")
      .send({ userId: "u_second", discountCode: couponCode });

    expect(secondRes.statusCode).toBe(400);
    expect(secondRes.body.message).toContain("Invalid or expired discount code");
  });

  it("should prevent concurrent checkouts from redeeming the same coupon", async () => {
    // Reach milestone and generate coupon
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `u_race_${i}`, productId: 4, qty: 1 });
      await request(app).post("/api/checkout").send({ userId: `u_race_${i}` });
    }

    const genRes = await request(app).post("/api/admin/generate-coupon");
    const couponCode = genRes.body.coupon.code;

    // Two users cart the same item and attempt checkout concurrently with the same coupon
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "competitor_1", productId: 1, qty: 1 });

    await request(app)
      .post("/api/cart/add")
      .send({ userId: "competitor_2", productId: 1, qty: 1 });

    const results = await Promise.all([
      request(app)
        .post("/api/checkout")
        .send({ userId: "competitor_1", discountCode: couponCode }),
      request(app)
        .post("/api/checkout")
        .send({ userId: "competitor_2", discountCode: couponCode }),
    ]);

    const successes = results.filter((r) => r.statusCode === 201);
    const failures = results.filter((r) => r.statusCode === 400);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].body.message).toContain("Invalid or expired discount code");
  });

  it("should not permanently consume a coupon if checkout fails", async () => {
    // Generate coupon
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `u_fail_${i}`, productId: 4, qty: 1 });
      await request(app).post("/api/checkout").send({ userId: `u_fail_${i}` });
    }

    const genRes = await request(app).post("/api/admin/generate-coupon");
    const couponCode = genRes.body.coupon.code;

    // User carts Product 5 (Headphones, inventory: 1)
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_failing", productId: 5, qty: 1 });

    // Simulate inventory becoming 0 right before checkout
    const p5 = products.find((p) => p.id === 5);
    p5.inventory = 0;

    // Checkout fails due to insufficient inventory
    const failRes = await request(app)
      .post("/api/checkout")
      .send({ userId: "user_failing", discountCode: couponCode });

    expect(failRes.statusCode).toBe(409);

    // Coupon must remain AVAILABLE and NOT consumed
    const couponInStore = coupons.find((c) => c.code === couponCode);
    expect(couponInStore.status).toBe("AVAILABLE");
    expect(couponInStore.redeemedAt).toBeNull();
  });
});
