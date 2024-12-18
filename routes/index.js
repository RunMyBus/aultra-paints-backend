const express = require('express');
const authRoutes = require('./authRoute');
const orderRoutes = require('./orderRoutes');
const productRoutes = require('./productRoutes');


const router = express.Router();

/** GET /health-check - Check service health */
router.get('/health-check', (req, res) => res.send('OK'));

router.use('/auth', authRoutes);
router.use('/order', orderRoutes);
router.use('/product', productRoutes);


module.exports = router;
