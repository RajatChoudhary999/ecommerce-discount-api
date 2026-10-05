const crypto = require("crypto");
const { discountState, orders, products, coupons } = require("../store/db");

/**
 * Returns the currently active, unredeemed discount code if available.
 */
const getActiveDiscountCode = (req, res) => {
  const activeCoupon = coupons.find((c) => c.status === "AVAILABLE");

  if (activeCoupon) {
    return res.json({
      message: "Discount code available",
      code: activeCoupon.code,
      discountPercent: activeCoupon.discountPercent,
    });
  }

  res.json({
    message: "No discount code available right now",
    code: null,
  });
};

/**
 * Generates a coupon when an unrewarded order milestone has been reached.
 */
const generateCoupon = (req, res) => {
  const eligibleMilestonesCount = Math.floor(
    orders.length / discountState.nthOrder,
  );
  const alreadyGeneratedCount = coupons.length;

  if (alreadyGeneratedCount >= eligibleMilestonesCount) {
    const nextMilestoneOrder =
      (alreadyGeneratedCount + 1) * discountState.nthOrder;
    return res.status(400).json({
      message: `No unrewarded milestone eligible for coupon generation. Next milestone at order ${nextMilestoneOrder}. Current orders: ${orders.length}.`,
      currentOrders: orders.length,
      nextMilestoneOrder,
    });
  }

  const milestoneOrder = (alreadyGeneratedCount + 1) * discountState.nthOrder;
  const code = "SAVE10-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const coupon = {
    code,
    discountPercent: discountState.discountPercent || 10,
    milestoneOrder,
    status: "AVAILABLE",
    createdAt: new Date().toISOString(),
    redeemedAt: null,
    redeemedInOrderId: null,
  };

  coupons.push(coupon);
  discountState.issuedCodes.push(code);
  discountState.activeCode = code;
  discountState.codeUsed = false;

  res.status(201).json({
    message: "Coupon generated successfully",
    coupon,
  });
};

/**
 * Generates an immutable, read-only administrative reporting summary
 * reconciling fully with historical orders and coupons.
 */
const getStats = (req, res) => {
  const purchasedQuantityByProduct = {};
  products.forEach((p) => {
    purchasedQuantityByProduct[p.id] = 0;
  });

  const productSales = products.map((p) => ({
    productId: p.id,
    name: p.name,
    quantity: 0,
  }));

  let totalItemsPurchased = 0;
  let grossRevenue = 0;
  let totalDiscountsGranted = 0;
  let netRevenue = 0;

  orders.forEach((order) => {
    grossRevenue += order.totalAmount;
    totalDiscountsGranted += order.discountApplied;
    netRevenue += order.finalAmount;

    order.items.forEach((item) => {
      totalItemsPurchased += item.qty;
      purchasedQuantityByProduct[item.productId] =
        (purchasedQuantityByProduct[item.productId] || 0) + item.qty;

      const sale = productSales.find((s) => s.productId === item.productId);
      if (sale) {
        sale.quantity += item.qty;
      }
    });
  });

  const couponsGenerated = coupons.length;
  const couponsAvailable = coupons.filter(
    (c) => c.status === "AVAILABLE",
  ).length;
  const couponsRedeemed = coupons.filter((c) => c.status === "REDEEMED").length;
  const activeCoupon = coupons.find((c) => c.status === "AVAILABLE");

  res.json({
    totalOrders: orders.length,
    totalItemsPurchased,
    purchasedQuantityByProduct,
    productSales,
    grossRevenue,
    totalDiscountsGranted,
    netRevenue,
    coupons: {
      generated: couponsGenerated,
      available: couponsAvailable,
      redeemed: couponsRedeemed,
    },
    issuedDiscountCodes: coupons.map((c) => c.code),
    totalPurchaseAmount: netRevenue,
    totalDiscountAmount: totalDiscountsGranted,
    activeCode: activeCoupon ? activeCoupon.code : null,
  });
};

module.exports = {
  getActiveDiscountCode,
  generateCoupon,
  getStats,
};
