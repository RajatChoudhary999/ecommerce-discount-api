const {
  carts,
  orders,
  products,
  coupons,
  discountState,
  idempotencyStore,
  checkoutLock,
} = require("../store/db");

/**
 * Executes checkout atomically with inventory validation, coupon redemption,
 * idempotency protection, and order snapshot persistence.
 */
const checkout = async (req, res) => {
  const { userId, discountCode } = req.body;
  const idempotencyKey =
    req.body.idempotencyKey ||
    req.headers["idempotency-key"] ||
    req.headers["x-idempotency-key"];

  if (!userId) {
    return res.status(400).json({ message: "userId required" });
  }

  // Idempotent retry check: return existing result if key was already processed
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey);
    return res.status(cached.statusCode).json({
      ...cached.data,
      idempotentReplay: true,
    });
  }

  // Acquire checkout lock to ensure serialized, atomic transaction
  try {
    const result = await checkoutLock.acquire(async () => {
      // Re-check idempotency key inside lock in case of concurrent duplicate retries
      if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
        const cached = idempotencyStore.get(idempotencyKey);
        return {
          statusCode: cached.statusCode,
          data: { ...cached.data, idempotentReplay: true },
        };
      }

      const cart = carts.get(userId);
      if (!cart || cart.items.length === 0) {
        return { statusCode: 400, data: { message: "Cart is empty" } };
      }

      if (cart.status === "CHECKED_OUT") {
        return {
          statusCode: 409,
          data: {
            message: "A cart cannot successfully checkout more than once",
          },
        };
      }

      // Validate inventory availability for all items
      for (const item of cart.items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) {
          return {
            statusCode: 404,
            data: {
              message: `Product with ID ${item.productId} not found`,
              productId: item.productId,
            },
          };
        }
        if (product.inventory < item.qty) {
          return {
            statusCode: 409,
            data: {
              message: `Insufficient inventory for product "${product.name}". Requested: ${item.qty}, available: ${product.inventory}`,
              productId: product.id,
            },
          };
        }
      }

      // Validate coupon if supplied
      let coupon = null;
      if (discountCode) {
        coupon = coupons.find((c) => c.code === discountCode);
        if (!coupon || coupon.status !== "AVAILABLE") {
          return {
            statusCode: 400,
            data: { message: "Invalid or expired discount code" },
          };
        }
      }

      // Snapshot line items with current catalog prices
      const detailedItems = cart.items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          name: product.name,
          price: product.price,
          qty: item.qty,
          total: product.price * item.qty,
        };
      });

      const totalAmount = detailedItems.reduce((sum, i) => sum + i.total, 0);

      // Safe money and discount calculation
      let discountApplied = 0;
      let discountPercent = 0;
      if (coupon) {
        discountPercent = coupon.discountPercent;
        discountApplied = Math.round((totalAmount * discountPercent) / 100);
        discountApplied = Math.min(discountApplied, totalAmount);
      }
      const finalAmount = Math.max(0, totalAmount - discountApplied);

      const nextOrderId = orders.length + 1;

      // Deduct inventory atomically
      for (const item of detailedItems) {
        const product = products.find((p) => p.id === item.productId);
        product.inventory -= item.qty;
        if (product.inventory < 0) {
          throw new Error("Inventory invariant violated: negative stock");
        }
      }

      // Redeem coupon atomically
      if (coupon) {
        coupon.status = "REDEEMED";
        coupon.redeemedAt = new Date().toISOString();
        coupon.redeemedInOrderId = nextOrderId;
        discountState.totalDiscountAmount += discountApplied;
      }

      // Transition cart state
      cart.status = "CHECKED_OUT";
      cart.checkedOutAt = new Date().toISOString();
      carts.delete(userId);

      // Persist order with immutable historical snapshot
      const order = {
        orderId: nextOrderId,
        userId,
        cartId: cart.id,
        items: detailedItems,
        totalAmount,
        discountCode: coupon ? coupon.code : null,
        discountPercent,
        discountApplied,
        finalAmount,
        createdAt: new Date().toISOString(),
      };

      orders.push(order);
      discountState.orderCount = orders.length;

      // Find if any active coupon is currently available for display
      const activeCoupon = coupons.find((c) => c.status === "AVAILABLE");
      const activeDiscountCode = activeCoupon ? activeCoupon.code : null;
      discountState.activeCode = activeDiscountCode;
      discountState.codeUsed = !activeCoupon;

      const responsePayload = {
        message: "Order placed successfully",
        order,
        activeDiscountCode,
      };

      if (idempotencyKey) {
        idempotencyStore.set(idempotencyKey, {
          statusCode: 201,
          data: responsePayload,
        });
      }

      return { statusCode: 201, data: responsePayload };
    });

    return res.status(result.statusCode).json(result.data);
  } catch (error) {
    return res.status(500).json({
      message: "Checkout failed due to internal error: " + error.message,
    });
  }
};

/**
 * Retrieves a historical order by orderId.
 */
const getOrder = (req, res) => {
  const { orderId } = req.params;
  const id = Number(orderId);
  const order = orders.find(
    (o) => o.orderId === id || String(o.orderId) === String(orderId),
  );

  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  res.json({ order });
};

module.exports = { checkout, getOrder };
