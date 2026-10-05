const express = require("express");
const {
  createCart,
  addToCart,
  updateCartItem,
  getCart,
  removeFromCart,
} = require("../controllers/cartController");

const router = express.Router();

router.post("/", createCart);
router.post("/add", addToCart);
router.put("/update", updateCartItem);
router.put("/", updateCartItem);
router.get("/:userId", getCart);
router.delete("/remove", removeFromCart);

module.exports = router;
