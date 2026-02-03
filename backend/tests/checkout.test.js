const request = require("supertest");
const app = require("../server");

describe("Checkout API", () => {
  it("should reject invalid discount code", async () => {
    // add item first
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u2", productId: 1, qty: 1 });

    // checkout with wrong code
    const res = await request(app)
      .post("/api/checkout")
      .send({ userId: "u2", discountCode: "WRONGCODE" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Invalid or expired discount code");
  });
});
