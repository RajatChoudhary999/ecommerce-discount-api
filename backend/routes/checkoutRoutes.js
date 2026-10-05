const express = require("express");
const router = express.Router();

const { checkout, getOrder } = require("../controllers/checkoutController");

router.post("/", checkout);
router.get("/:orderId", getOrder);
router.get("/order/:orderId", getOrder);

module.exports = router;
