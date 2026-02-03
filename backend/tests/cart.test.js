const request = require("supertest");
const app = require("../server");

describe("Cart API", () => {
  it("should add item to cart", async () => {
    const res = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Item added to cart");
    expect(res.body.cart.items.length).toBe(1);
  });
});
