const express = require("express");
const dotenv = require("dotenv");
const connectToDatabase = require("./config/dbConnection");
const User = require("./routes/userRoutes");
const Task = require("./routes/taskRoutes");
const Cart = require("./routes/cartRoutes");
const Checkout = require("./routes/checkoutRoutes");
const Admin = require("./routes/adminRoutes");
const { notFound, errorHandler } = require("./middlewares/errorMiddleware");
const syncModels = require("./config/syncModels");
const cors = require("cors");

require("dotenv").config();

//DB Work
require("./config/dbConnection");
// syncModels();

const app = express();
app.use(express.json()); // to Accept Json Data
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

app.get("/", (req, res) => {
  res.send("API is Running");
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// app.use("/api/user", User);
// app.use("/api/task", Task);
app.use("/api/cart", Cart);
app.use("/api/checkout", Checkout);
app.use("/api/admin", Admin);

//If no routes exist it will fall on this
app.use(notFound);
//If still there is a error it will fall on this
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server Started on Port ${PORT}`);
});

//7:27
