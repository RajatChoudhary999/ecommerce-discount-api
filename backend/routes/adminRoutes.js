const express = require("express");
const {
  getActiveDiscountCode,
  getStats,
} = require("../controllers/adminController");
const router = express.Router();

router.get("/discount-code", getActiveDiscountCode);
router.get("/stats", getStats);

module.exports = router;
