const mongoose = require("mongoose");

let db;


const mongoConnect = (callback) => {
  mongoose
    .connect(
      "mongodb+srv://oilrefinery:QWKrpLiEuJZTj31q@cluster0.rq2i7mn.mongodb.net/Refainery"
    )
    .then(() => {
      db = mongoose.connection;
      console.log("✅ Connected to MongoDB");
      callback();
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err);
    });
};

const getDb = () => {
  if (db) {
    return db;
  } else {
    console.log("⚠️ Database is not initialized");
    return null;
  }
};

module.exports = {
  mongoConnect,
  getDb,
};
