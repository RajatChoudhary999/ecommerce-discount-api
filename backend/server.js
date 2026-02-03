const express = require("express");
const cors = require("cors");

const Cart = require("./routes/cartRoutes");
const Checkout = require("./routes/checkoutRoutes");
const Admin = require("./routes/adminRoutes");
const { notFound, errorHandler } = require("./middlewares/errorMiddleware");

require("dotenv").config();

const app = express();

app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

app.get("/", (req, res) => {
  res.send("API is Running");
});

app.use("/api/cart", Cart);
app.use("/api/checkout", Checkout);
app.use("/api/admin", Admin);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
