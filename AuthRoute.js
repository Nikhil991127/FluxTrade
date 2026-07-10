const { Signup } = require("./controllers/AuthController.js");
const { Login } = require("./controllers/LoginController.js");
const router = require("express").Router();
const { userVerification } = require("./middlewares/AuthMiddleware.js");

// GET, not POST: this is a "who am I" check with no body, called by the
// frontend on page load via a plain fetch() (which defaults to GET).
router.get("/user", userVerification);
router.post("/signup", Signup);
router.post("/login", Login);


module.exports = router;
