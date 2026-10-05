const express = require("express");
const {
  getActiveDiscountCode,
  generateCoupon,
  getStats,
} = require("../controllers/adminController");

const router = express.Router();

router.get("/discount-code", getActiveDiscountCode);
router.post("/generate-coupon", generateCoupon);
router.post("/coupon", generateCoupon);
router.get("/stats", getStats);

module.exports = router;
