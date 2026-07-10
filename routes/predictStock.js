const express = require("express");
const router = express.Router();
const axios = require("axios");
const { spawn } = require("child_process");

const API_KEY = process.env.ALPHA_VANTAGE_KEY;
const PYTHON_BIN = process.env.PYTHON_BIN || "python";

// =======================
// Fetch stock data
// =======================
async function fetchStockData(symbol) {
  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
      symbol.trim().toUpperCase()
    )}&outputsize=compact&apikey=${API_KEY}`;

  const { data } = await axios.get(url);

  console.log("AlphaVantage Response:", data);

  if (data.Note) {
    throw new Error(data.Note);
  }

  if (data.Information) {
    throw new Error(data.Information);
  }

  if (data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }

  const series = data["Time Series (Daily)"];

  if (!series) {
    throw new Error("No historical data found.");
  }

  return Object.entries(series)
    .map(([date, value]) => ({
      date,
      close: Number(value["4. close"]),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// =======================
// Prediction Route
// =======================
router.post("/predict", async (req, res) => {
  try {
    const { symbol, days = 5 } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: "Stock symbol is required",
      });
    }

    const historical = await fetchStockData(symbol);

    const py = spawn(PYTHON_BIN, [
      __dirname + "/../ml/predict_stock.py",
      String(days),
    ]);

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    py.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    py.on("close", (code) => {
      if (code !== 0) {
        console.error(stderr);

        return res.status(500).json({
          success: false,
          error: stderr || "Python prediction failed",
        });
      }

      try {
        const output = JSON.parse(stdout);

        if (output.error) {
          return res.status(500).json({
            success: false,
            error: output.error,
          });
        }

        return res.json({
          success: true,
          model: output.model,
          last_known: output.last_known,
          predictions: output.predictions,
        });

      } catch (err) {
        console.error(stdout);

        return res.status(500).json({
          success: false,
          error: "Invalid JSON returned from Python",
        });
      }
    });

    py.stdin.write(JSON.stringify({ historical }));
    py.stdin.end();

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;