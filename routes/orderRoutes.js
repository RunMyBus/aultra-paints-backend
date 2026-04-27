const express = require('express');
const router = express.Router();
const passport = require("passport");
const orderController = require("../controllers/ordersController");
const { requireRole, ADMIN, STAFF, ORDER_CREATORS } = require('../middleware/authorize');

router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', requireRole(ORDER_CREATORS), orderController.createOrder);
router.post('/orders', orderController.getOrders);
router.get('/details/:orderId', orderController.getOrderDetails);
router.put('/updateOrderStatus', requireRole(STAFF), orderController.updateOrderStatus);
router.post('/retryFocusSync', requireRole(ADMIN), orderController.retryFocusSync);

module.exports = router;
