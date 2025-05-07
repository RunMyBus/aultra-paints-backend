const express = require('express');
const router = express.Router();
const passport = require("passport");
const orderController = require("../controllers/ordersController");

router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', orderController.createOrder);
router.get('/orders', orderController.getOrders);
router.put('/updateOrderStatus', orderController.updateOrderStatus);

module.exports = router;
