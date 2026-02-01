const products = [
  { id: 1, name: "Shirt", price: 1000 },
  { id: 2, name: "Shoes", price: 3000 },
  { id: 3, name: "Watch", price: 5000 },
];

// userId -> { items: [{ productId, qty }] }
const carts = new Map();

// placed orders
const orders = [];

// discount system state
const discountState = {
  nthOrder: 2,
  orderCount: 0,
  activeCode: null,
  codeUsed: true,
  issuedCodes: [],
  totalDiscountAmount: 0,
};

module.exports = {
  products,
  carts,
  orders,
  discountState,
};
