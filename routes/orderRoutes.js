const express = require('express');
const router = express.Router();
const passport = require("passport");
const orderController = require("../controllers/ordersController");

router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', orderController.createOrder);

module.exports = router;