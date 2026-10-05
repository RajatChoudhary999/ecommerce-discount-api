const request = require("supertest");
const app = require("../server");
const { resetStore } = require("../store/db");

describe("Admin Reporting API", () => {
  beforeEach(() => {
    resetStore();
  });

  it("should reconcile reporting summary with placed orders and coupons", async () => {
    // 1. Initial report on empty store
    const emptyStats = await request(app).get("/api/admin/stats");
    expect(emptyStats.statusCode).toBe(200);
    expect(emptyStats.body.totalOrders).toBe(0);
    expect(emptyStats.body.grossRevenue).toBe(0);
    expect(emptyStats.body.netRevenue).toBe(0);
    expect(emptyStats.body.totalDiscountsGranted).toBe(0);
    expect(emptyStats.body.coupons.generated).toBe(0);
    expect(emptyStats.body.coupons.available).toBe(0);
    expect(emptyStats.body.coupons.redeemed).toBe(0);

    // 2. Place 5 orders to trigger milestone
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post("/api/cart/add")
        .send({ userId: `user_stat_${i}`, productId: 4, qty: 2 }); // Book: 500 * 2 = 1000

      await request(app)
        .post("/api/checkout")
        .send({ userId: `user_stat_${i}` });
    }

    // 3. Admin generates a coupon
    const couponRes = await request(app).post("/api/admin/generate-coupon");
    expect(couponRes.statusCode).toBe(201);
    const code = couponRes.body.coupon.code;

    // 4. Place 6th order using the coupon
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_stat_6", productId: 1, qty: 1 }); // Shirt: 1000

    await request(app)
      .post("/api/checkout")
      .send({ userId: "user_stat_6", discountCode: code }); // 100 discount, 900 final

    // 5. Fetch admin stats
    const statsRes = await request(app).get("/api/admin/stats");
    expect(statsRes.statusCode).toBe(200);

    const stats = statsRes.body;
    expect(stats.totalOrders).toBe(6);
    expect(stats.totalItemsPurchased).toBe(11); // 5 * 2 + 1 = 11

    // Product breakdown: Product 4 = 10, Product 1 = 1
    expect(stats.purchasedQuantityByProduct["4"]).toBe(10);
    expect(stats.purchasedQuantityByProduct["1"]).toBe(1);

    // Revenue calculations: 5 * 1000 + 1000 = 6000 gross
    expect(stats.grossRevenue).toBe(6000);
    expect(stats.totalDiscountsGranted).toBe(100);
    expect(stats.netRevenue).toBe(5900);

    // Coupon metrics: 1 generated, 0 available, 1 redeemed
    expect(stats.coupons.generated).toBe(1);
    expect(stats.coupons.available).toBe(0);
    expect(stats.coupons.redeemed).toBe(1);
  });

  it("should be strictly read-only and idempotent across repeated calls", async () => {
    // Place an order
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "user_ro", productId: 1, qty: 1 });
    await request(app).post("/api/checkout").send({ userId: "user_ro" });

    const firstStats = await request(app).get("/api/admin/stats");
    const secondStats = await request(app).get("/api/admin/stats");
    const thirdStats = await request(app).get("/api/admin/stats");

    expect(firstStats.body).toEqual(secondStats.body);
    expect(secondStats.body).toEqual(thirdStats.body);
  });
});
