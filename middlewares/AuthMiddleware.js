const UsersModel = require("../models/UsersModel");
require("dotenv").config();
const jwt = require("jsonwebtoken");

function extractToken(req) {
  return req.cookies?.token || req.headers.authorization?.split(" ")[1];
}

// "Who am I" check used by the frontend to restore a session on page load.
// Always responds (never blocks the request chain), even when unauthenticated.
module.exports.userVerification = async (req, res) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.json({ success: false, message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.TOKEN_KEY);
    const user = await UsersModel.findById(decoded.id).select("fullName email");

    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      user: {
        username: user.fullName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Verification error:", error.message);
    return res.json({ success: false, message: "Invalid or expired token" });
  }
};

// Route guard for per-user data endpoints (holdings, positions, orders, trading).
// Sets req.userId and calls next() on success; responds 401 and stops the chain otherwise.
module.exports.requireAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.TOKEN_KEY);
    const user = await UsersModel.findById(decoded.id).select("_id");

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    req.userId = user._id;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};
