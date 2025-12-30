const express = require("express");
const router = express.Router();

const YahooFinance = require("yahoo-finance2").default;
const fetch = require("node-fetch");

const yahooFinance = new YahooFinance({
  fetch,
  suppressNotices: ["ripHistorical"],
});

const { spawn } = require("child_process");
const PYTHON_BIN = process.env.PYTHON_BIN || "python";

// Fetch 6 months historical data
async function fetchYahooDaily(symbol) {
  try {
    const period2 = new Date();
    const period1 = new Date(period2);
    period1.setMonth(period1.getMonth() - 6);

    const result = await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: "1d",
    });

    if (!result?.quotes?.length) {
      throw new Error("No historical data found");
    }

    return result.quotes.map((q) => ({
      date: q.date.toISOString().split("T")[0],
      close: q.close,
    }));
  } catch (err) {
    console.error("YAHOO FINANCE ERROR:", err);
    throw err;
  }
}

// =======================
// POST /api/predict
// =======================
router.post("/predict", async (req, res) => {
  try {
    const { symbol, days = 1 } = req.body;
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });

    console.log("Fetching data for:", symbol);

    const histData = await fetchYahooDaily(symbol);

    const py = spawn(PYTHON_BIN, [
      __dirname + "/../ml/predict_stock.py",
      String(days),
    ]);

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).json({
          error: "Python prediction failed",
          details: stderr,
        });
      }

      try {
        const parsed = JSON.parse(stdout);
        res.json({ success: true, ...parsed });
      } catch (e) {
        res.status(500).json({
          error: "Invalid JSON from Python",
          details: e.message,
        });
      }
    });

    py.stdin.write(JSON.stringify({ historical: histData }));
    py.stdin.end();
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

