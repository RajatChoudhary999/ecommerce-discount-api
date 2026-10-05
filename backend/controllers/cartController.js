const { carts, cartsById, products } = require("../store/db");

/**
 * Creates or retrieves an active cart for a given user.
 */
const createCart = (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ message: "userId required" });
  }

  let cart = carts.get(userId);
  if (!cart || cart.status !== "ACTIVE") {
    const cartId = `cart_${cartsById.size + 1}_${Date.now()}`;
    cart = {
      id: cartId,
      userId,
      items: [],
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    carts.set(userId, cart);
    cartsById.set(cartId, cart);
  }

  res.status(200).json({
    message: "Cart ready",
    cart,
  });
};

/**
 * Adds an item to the user's active cart with inventory and quantity validation.
 */
const addToCart = (req, res) => {
  const { userId, productId, qty } = req.body;

  if (!userId || productId === undefined || qty === undefined) {
    return res.status(400).json({ message: "Missing fields" });
  }

  if (!Number.isInteger(qty) || qty <= 0) {
    return res
      .status(400)
      .json({ message: "Quantity must be a positive integer" });
  }

  const product = products.find((p) => p.id === productId);
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  let cart = carts.get(userId);
  if (!cart || cart.status !== "ACTIVE") {
    const cartId = `cart_${cartsById.size + 1}_${Date.now()}`;
    cart = {
      id: cartId,
      userId,
      items: [],
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    carts.set(userId, cart);
    cartsById.set(cartId, cart);
  }

  const existing = cart.items.find((i) => i.productId === productId);
  const totalRequestedQty = (existing ? existing.qty : 0) + qty;

  if (totalRequestedQty > product.inventory) {
    return res.status(400).json({
      message: `Requested quantity (${totalRequestedQty}) exceeds available inventory (${product.inventory})`,
    });
  }

  if (existing) {
    existing.qty += qty;
  } else {
    cart.items.push({ productId, qty });
  }

  res.json({
    message: "Item added to cart",
    cart,
  });
};

/**
 * Updates an item's quantity in the user's active cart.
 */
const updateCartItem = (req, res) => {
  const { userId, productId, qty } = req.body;

  if (!userId || productId === undefined || qty === undefined) {
    return res.status(400).json({ message: "Missing fields" });
  }

  if (!Number.isInteger(qty) || qty < 0) {
    return res
      .status(400)
      .json({ message: "Quantity must be a non-negative integer" });
  }

  const product = products.find((p) => p.id === productId);
  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  const cart = carts.get(userId);
  if (!cart || cart.status !== "ACTIVE" || cart.items.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  const existing = cart.items.find((i) => i.productId === productId);
  if (!existing) {
    return res.status(404).json({ message: "Item not found in cart" });
  }

  if (qty === 0) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
    return res.json({
      message: "Item removed from cart",
      cart,
    });
  }

  if (qty > product.inventory) {
    return res.status(400).json({
      message: `Requested quantity (${qty}) exceeds available inventory (${product.inventory})`,
    });
  }

  existing.qty = qty;

  res.json({
    message: "Cart item updated",
    cart,
  });
};

/**
 * Retrieves the user's active cart enriched with live product details, inventory, and totals.
 */
const getCart = (req, res) => {
  const { userId } = req.params;

  const cart = carts.get(userId);

  if (!cart || cart.items.length === 0) {
    return res.json({
      message: "Cart is empty",
      cartId: cart ? cart.id : null,
      userId,
      status: cart ? cart.status : "ACTIVE",
      items: [],
      cart: { items: [] },
      totalAmount: 0,
    });
  }

  const detailedItems = cart.items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const unitPrice = product ? product.price : 0;
    const inventory = product ? product.inventory : 0;
    return {
      productId: item.productId,
      name: product ? product.name : "Unknown Product",
      price: unitPrice,
      availableInventory: inventory,
      qty: item.qty,
      total: unitPrice * item.qty,
    };
  });

  const totalAmount = detailedItems.reduce((sum, i) => sum + i.total, 0);

  res.json({
    cartId: cart.id,
    userId,
    status: cart.status,
    items: detailedItems,
    cart: { items: cart.items },
    totalAmount,
  });
};

/**
 * Removes an item completely from the user's active cart.
 */
const removeFromCart = (req, res) => {
  const { userId, productId } = req.body;

  if (!userId || productId === undefined) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const cart = carts.get(userId);

  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  cart.items = cart.items.filter((item) => item.productId !== productId);

  res.json({
    message: "Item removed from cart",
    cart,
  });
};

module.exports = {
  createCart,
  addToCart,
  updateCartItem,
  getCart,
  removeFromCart,
};
