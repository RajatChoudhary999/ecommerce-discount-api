const crypto = require("crypto");
const { carts, orders, products, discountState } = require("../store/db");

const checkout = (req, res) => {
  const { userId, discountCode } = req.body;

  if (!userId) {
    return res.status(400).json({ message: "userId required" });
  }

  const cart = carts.get(userId);
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  // calculate total
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

  // coupon validation
  let discountApplied = 0;

  if (discountCode) {
    if (
      discountState.activeCode === discountCode &&
      discountState.codeUsed === false
    ) {
      discountApplied = totalAmount * 0.1;
      discountState.codeUsed = true;
      discountState.totalDiscountAmount += discountApplied;
    } else {
      return res
        .status(400)
        .json({ message: "Invalid or expired discount code" });
    }
  }

  const finalAmount = totalAmount - discountApplied;

  // create order
  const order = {
    orderId: orders.length + 1,
    userId,
    items: detailedItems,
    totalAmount,
    discountApplied,
    finalAmount,
  };

  orders.push(order);

  // clear cart
  carts.delete(userId);

  // increment successful order count
  discountState.orderCount += 1;

  // every nth order generate new coupon
  if (discountState.orderCount % discountState.nthOrder === 0) {
    const newCode = "SAVE10-" + crypto.randomBytes(3).toString("hex");

    discountState.activeCode = newCode;
    discountState.codeUsed = false;
    discountState.issuedCodes.push(newCode);
  }

  res.json({
    message: "Order placed successfully",
    order,
    activeDiscountCode:
      discountState.codeUsed === false ? discountState.activeCode : null,
  });
};

module.exports = { checkout };
