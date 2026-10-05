const crypto = require("crypto");

/**
 * Mutex lock to serialize critical transaction blocks (e.g. checkout operations).
 */
class AsyncLock {
  constructor() {
    this._queue = Promise.resolve();
  }

  acquire(fn) {
    const result = this._queue.then(() => fn());
    this._queue = result.catch(() => {});
    return result;
  }
}

const checkoutLock = new AsyncLock();

const INITIAL_PRODUCTS = [
  { id: 1, name: "Shirt", price: 1000, inventory: 10 },
  { id: 2, name: "Shoes", price: 3000, inventory: 5 },
  { id: 3, name: "Watch", price: 5000, inventory: 2 }, // limited inventory
  { id: 4, name: "Book", price: 500, inventory: 20 },
  { id: 5, name: "Headphones", price: 2000, inventory: 1 }, // very limited inventory
];

// Product catalog (in-place mutable array)
const products = INITIAL_PRODUCTS.map((p) => ({ ...p }));

// userId -> cart object { id, userId, items: [{ productId, qty }], status: 'ACTIVE' | 'CHECKED_OUT' }
const carts = new Map();
// cartId -> cart object
const cartsById = new Map();

// Placed historical orders
const orders = [];

// Generated discount coupons
const coupons = [];

// Idempotency cache: idempotencyKey -> { statusCode, data }
const idempotencyStore = new Map();

// Discount system configuration and metrics
const discountState = {
  nthOrder: Number(process.env.NTH_ORDER) || 5,
  discountPercent: Number(process.env.DISCOUNT_PERCENT) || 10,
  orderCount: 0,
  activeCode: null,
  codeUsed: true,
  issuedCodes: [],
  totalDiscountAmount: 0,
};

/**
 * Resets all in-memory data structures in-place to their initial seeded state.
 * Mutates arrays in-place so module-destructured references remain valid.
 */
function resetStore() {
  products.length = 0;
  INITIAL_PRODUCTS.forEach((p) => products.push({ ...p }));

  carts.clear();
  cartsById.clear();
  orders.length = 0;
  coupons.length = 0;
  idempotencyStore.clear();

  discountState.nthOrder = Number(process.env.NTH_ORDER) || 5;
  discountState.discountPercent = Number(process.env.DISCOUNT_PERCENT) || 10;
  discountState.orderCount = 0;
  discountState.activeCode = null;
  discountState.codeUsed = true;
  discountState.issuedCodes.length = 0;
  discountState.totalDiscountAmount = 0;
}

module.exports = {
  products,
  carts,
  cartsById,
  orders,
  coupons,
  idempotencyStore,
  discountState,
  checkoutLock,
  resetStore,
};
