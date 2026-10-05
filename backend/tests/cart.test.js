const request = require("supertest");
const app = require("../server");
const { resetStore, products } = require("../store/db");

describe("Cart API", () => {
  beforeEach(() => {
    resetStore();
  });

  it("should add item to cart", async () => {
    const res = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Item added to cart");
    expect(res.body.cart.items.length).toBe(1);
    expect(res.body.cart.items[0]).toEqual({ productId: 1, qty: 2 });
  });

  it("should reject adding item with invalid or non-positive quantity", async () => {
    const resNegative = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: -1 });

    expect(resNegative.statusCode).toBe(400);

    const resZero = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 0 });

    expect(resZero.statusCode).toBe(400);

    const resFloat = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 1.5 });

    expect(resFloat.statusCode).toBe(400);
  });

  it("should reject adding non-existent product", async () => {
    const res = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 9999, qty: 1 });

    expect(res.statusCode).toBe(404);
  });

  it("should reject adding quantity exceeding available inventory", async () => {
    // Product 5 has inventory: 1
    const res = await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 5, qty: 5 });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("exceeds available inventory");
  });

  it("should update item quantity in cart and remove if quantity is 0", async () => {
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 2 });

    const updateRes = await request(app)
      .put("/api/cart/update")
      .send({ userId: "u1", productId: 1, qty: 4 });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.body.cart.items[0].qty).toBe(4);

    const zeroRes = await request(app)
      .put("/api/cart/update")
      .send({ userId: "u1", productId: 1, qty: 0 });

    expect(zeroRes.statusCode).toBe(200);
    expect(zeroRes.body.cart.items.length).toBe(0);
  });

  it("should remove item from cart", async () => {
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 2 });

    const removeRes = await request(app)
      .delete("/api/cart/remove")
      .send({ userId: "u1", productId: 1 });

    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.body.message).toBe("Item removed from cart");
    expect(removeRes.body.cart.items.length).toBe(0);
  });

  it("should view cart with enriched product details and totals", async () => {
    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 1, qty: 2 }); // 1000 * 2 = 2000

    await request(app)
      .post("/api/cart/add")
      .send({ userId: "u1", productId: 2, qty: 1 }); // 3000 * 1 = 3000

    const res = await request(app).get("/api/cart/u1");

    expect(res.statusCode).toBe(200);
    expect(res.body.userId).toBe("u1");
    expect(res.body.items.length).toBe(2);
    expect(res.body.totalAmount).toBe(5000);
    expect(res.body.items[0].name).toBe("Shirt");
    expect(res.body.items[0].price).toBe(1000);
    expect(res.body.items[0].availableInventory).toBe(10);
  });
});
