const express = require('express');
const router = express.Router();
const passport = require("passport");
const orderController = require("../controllers/ordersController");
const { requireRole, ADMIN, STAFF, ORDER_CREATORS, ORDER_EDITORS } = require('../middleware/authorize');

router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', requireRole(ORDER_CREATORS), orderController.createOrder);
router.post('/orders', orderController.getOrders);
router.get('/details/:orderId', orderController.getOrderDetails);
router.get('/dealers', requireRole(STAFF), orderController.getOrderDealers);
router.put('/updateOrderStatus', requireRole(STAFF), orderController.updateOrderStatus);
router.put('/updateOrderStatusManual', requireRole(ORDER_EDITORS), orderController.updateOrderStatusManual);
router.post('/retryFocusSync', requireRole(ADMIN), orderController.retryFocusSync);

module.exports = router;
