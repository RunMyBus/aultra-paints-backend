const express = require('express');
const authRoutes = require('./authRoute');
const orderRoutes = require('./orderRoutes');
const batchnumberRoutes = require('./batchnumberRoute');
const productRoutes = require('./productRoutes');
const branchRoutes = require('./branchRoutes');
const transactionRoutes = require('./transactionRoutes');


const router = express.Router();

/** GET /health-check - Check service health */
router.get('/health-check', (req, res) => res.send('OK'));

router.use('/auth', authRoutes);
router.use('/order', orderRoutes);
router.use('/batchnumbers', batchnumberRoutes);
router.use('/product', productRoutes);
router.use('/branches', branchRoutes);
router.use('/transaction', transactionRoutes);


module.exports = router;
