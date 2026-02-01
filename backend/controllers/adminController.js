const { discountState, orders } = require("../store/db");

const getActiveDiscountCode = (req, res) => {
  if (discountState.activeCode && discountState.codeUsed === false) {
    return res.json({
      message: "Discount code available",
      code: discountState.activeCode,
      discountPercent: 10,
    });
  }

  res.json({
    message: "No discount code available right now",
    code: null,
  });
};

const getStats = (req, res) => {
  let totalItemsPurchased = 0;
  let totalPurchaseAmount = 0;

  orders.forEach((order) => {
    totalPurchaseAmount += order.finalAmount;

    order.items.forEach((item) => {
      totalItemsPurchased += item.qty;
    });
  });

  res.json({
    totalOrders: orders.length,
    totalItemsPurchased,
    totalPurchaseAmount,
    issuedDiscountCodes: discountState.issuedCodes,
    totalDiscountAmount: discountState.totalDiscountAmount,
    activeCode:
      discountState.codeUsed === false ? discountState.activeCode : null,
  });
};

module.exports = {
  getActiveDiscountCode,
  getStats,
};
