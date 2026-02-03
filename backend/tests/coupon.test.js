const request = require("supertest");
const app = require("../server");

describe("Coupon Generation", () => {
  it("should generate discount code on every 5th order", async () => {
    let activeCode = null;

    for (let i = 1; i <= 5; i++) {
      // add item
      await request(app)
        .post("/api/cart/add")
        .send({ userId: "u5", productId: 1, qty: 1 });

      // checkout
      const res = await request(app)
        .post("/api/checkout")
        .send({ userId: "u5" });

      if (i === 5) {
        activeCode = res.body.activeDiscountCode;
      }
    }

    expect(activeCode).not.toBeNull();
    expect(activeCode).toContain("SAVE10-");
  });
});
