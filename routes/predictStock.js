const express = require("express");
const router = express.Router();

const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical"],
});

const { spawn } = require("child_process");

const PYTHON_BIN = process.env.PYTHON_BIN || "python";

// Fetch 6 months historical data from Yahoo Finance
async function fetchYahooDaily(symbol) {
  try {
    // last 6 months
    const period2 = new Date();               // today
    const period1 = new Date(period2);        
    period1.setMonth(period1.getMonth() - 6); // 6 months ago

    const result = await yahooFinance.chart(symbol, {
      period1: period1,
      period2: period2,
      interval: "1d",
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      throw new Error("No historical data found for this symbol.");
    }

    // normalize output for ML model
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

    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    console.log("Fetching data for:", symbol);

    // Fetch Yahoo data
    const histData = await fetchYahooDaily(symbol);

    // Run Python ML model
    const py = spawn(PYTHON_BIN, [
      __dirname + "/../ml/predict_stock.py",
      String(days),
    ]);

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    py.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    py.on("close", (code) => {
      if (code !== 0) {
        console.error("Python error:", stderr);
        return res.status(500).json({
          error: "Python prediction script failed",
          details: stderr,
        });
      }

      try {
        const parsed = JSON.parse(stdout);
        return res.json({ success: true, ...parsed });
      } catch (err) {
        console.error("JSON parse error:", err);
        return res.status(500).json({
          error: "Invalid JSON from Python",
          details: err.message,
        });
      }
    });

    // Send historical data to Python
    py.stdin.write(JSON.stringify({ historical: histData }));
    py.stdin.end();
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
