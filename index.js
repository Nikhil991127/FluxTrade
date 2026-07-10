require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");

const HoldingsModel = require("./models/HoldingsModel.js");
const { PositionsModel } = require("./models/PositionsModel.js");
const { OrdersModel } = require("./models/OrdersModel.js");
const cookieParser = require("cookie-parser");
const AuthRoute = require("./AuthRoute.js");
const { requireAuth } = require("./middlewares/AuthMiddleware.js");

const Port = process.env.PORT || 3004;
const url = process.env.MONGO_URL;
const app = express();
const cors = require("cors");
const predictRoute = require("./routes/predictStock");

app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(bodyParser.json());
app.use(express.json());
app.use(cookieParser());

app.use("/api", predictRoute);
app.use("/", AuthRoute);

// ---------------------------------------------------------------------------
// Everything below this line is a signed-in user's own trading data.
// requireAuth sets req.userId; every query is scoped to it so each user only
// ever sees (and can only ever modify) their own holdings/positions/orders.
// ---------------------------------------------------------------------------

app.get("/allHoldings", requireAuth, async (req, res) => {
  try {
    const allHoldings = await HoldingsModel.find({ userId: req.userId });
    res.json(allHoldings);
  } catch (err) {
    console.error("Error fetching holdings:", err);
    res.status(500).json({ message: "Error fetching holdings" });
  }
});

app.get("/allPositions", requireAuth, async (req, res) => {
  try {
    const allPositions = await PositionsModel.find({ userId: req.userId });
    res.json(allPositions);
  } catch (err) {
    console.error("Error fetching positions:", err);
    res.status(500).json({ message: "Error fetching positions" });
  }
});

app.get("/allOrders", requireAuth, async (req, res) => {
  try {
    const allOrders = await OrdersModel.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(allOrders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// Places a BUY or SELL order for the signed-in user, records it, and applies
// its effect to that user's Holdings so qty / avg price / LTP update live:
//   BUY  -> creates the holding, or adds to qty and recomputes the weighted
//           average cost if the user already holds that stock
//   SELL -> reduces qty (rejected if it would go negative), removing the
//           holding entirely once qty reaches 0
// The holding's `price` is always set to the trade price, so the "LTP"
// column reflects the latest price the user actually traded at.
app.post("/addNewOrder", requireAuth, async (req, res) => {
  try {
    const { name, qty, price, mode } = req.body;

    if (!name || !qty || !price || !mode) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const quantity = Number(qty);
    const tradePrice = Number(price);
    const normalizedMode = String(mode).toUpperCase();

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: "Quantity must be a positive number" });
    }
    if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
      return res.status(400).json({ success: false, message: "Price must be a positive number" });
    }
    if (!["BUY", "SELL"].includes(normalizedMode)) {
      return res.status(400).json({ success: false, message: "Mode must be BUY or SELL" });
    }

    const existingHolding = await HoldingsModel.findOne({ userId: req.userId, name });

    if (normalizedMode === "BUY") {
      if (existingHolding) {
        const newQty = existingHolding.qty + quantity;
        const newAvg =
          (existingHolding.qty * existingHolding.avg + quantity * tradePrice) / newQty;

        existingHolding.qty = newQty;
        existingHolding.avg = newAvg;
        existingHolding.price = tradePrice;
        await existingHolding.save();
      } else {
        await HoldingsModel.create({
          userId: req.userId,
          name,
          qty: quantity,
          avg: tradePrice,
          price: tradePrice,
          net: "0.00%",
          day: "0.00%",
        });
      }
    } else {
      // SELL
      if (!existingHolding || existingHolding.qty < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient holdings: you only hold ${existingHolding ? existingHolding.qty : 0} ${name}`,
        });
      }

      const remainingQty = existingHolding.qty - quantity;

      if (remainingQty === 0) {
        await HoldingsModel.deleteOne({ _id: existingHolding._id });
      } else {
        existingHolding.qty = remainingQty;
        existingHolding.price = tradePrice;
        await existingHolding.save();
      }
    }

    const newOrder = new OrdersModel({
      userId: req.userId,
      name,
      qty: quantity,
      price: tradePrice,
      mode: normalizedMode,
    });
    await newOrder.save();

    return res.status(200).json({
      success: true,
      message: `${normalizedMode === "BUY" ? "Buy" : "Sell"} order placed successfully`,
      newOrder,
    });
  } catch (error) {
    console.error("Error placing order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to place order",
      error: error.message,
    });
  }
});

app.listen(Port, () => {
  console.log("Server started at port", Port);
});

mongoose.connect(url)
  .then(() => {
    console.log("db connected successfully");
  })
  .catch((err) => {
    console.error("Error connecting to the database", err);
  })
