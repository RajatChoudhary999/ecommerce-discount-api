const { carts, products } = require("../store/db");

const addToCart = (req, res) => {
  const { userId, productId, qty } = req.body;

  if (!(userId && productId && qty)) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const product = products.find((p) => p.id === productId);
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  const cart = carts.get(userId) || { items: [] };

  const existing = cart.items.find((i) => i.productId === productId);

  if (existing) {
    existing.qty += qty;
  } else {
    cart.items.push({ productId, qty });
  }

  carts.set(userId, cart);

  res.json({
    message: "Item added to cart",
    cart,
  });
};

const getCart = (req, res) => {
  const { userId } = req.params;

  const cart = carts.get(userId);

  if (!cart || cart.items.length === 0) {
    return res.json({
      message: "Cart is empty",
      cart: { items: [] },
    });
  }

  // enrich with product details
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

  res.json({
    userId,
    items: detailedItems,
    totalAmount,
  });
};

const removeFromCart = (req, res) => {
  const { userId, productId } = req.body;

  if (!(userId && productId)) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const cart = carts.get(userId);

  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  const updatedItems = cart.items.filter(
    (item) => item.productId !== productId,
  );

  cart.items = updatedItems;
  carts.set(userId, cart);

  res.json({
    message: "Item removed from cart",
    cart,
  });
};

module.exports = { addToCart, getCart, removeFromCart };
