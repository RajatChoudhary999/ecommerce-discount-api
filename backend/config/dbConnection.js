const { Sequelize } = require("sequelize");

require("dotenv").config();

const sequelize = new Sequelize("testdb", "postgres", process.env.DB_PASSWORD, {
  host: "localhost",
  port: 5432,
  dialect: "postgres",
  logging: false,
});

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("Connection has been established successfully.");
  } catch (error) {
    console.error("Unable to connect to the database:", error.message);
  }
};

connectDB();

module.exports = sequelize;
