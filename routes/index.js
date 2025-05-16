const express = require('express');
const authRoutes = require('./authRoute');
const batchnumberRoutes = require('./batchnumberRoute');
const transactionRoutes = require('./transactionRoutes');
const usersRoutes = require('./usersRoutes');
const brandRoutes = require('./brandRoutes.js');
const productRoutes = require('./productRoutes.js')
const productOffersRoutes = require('./productOffers.route')
const rewardSchemesRoutes = require('./rewardSchemes.route.js')
const transferRoutes = require('./transfer.route.js')
const cashFreeRoutes = require('./cashFreeRoutes')
const transactionLedgerRoutes = require('./transactionLedgerRoute')
const statesRoutes = require('./stateRoutes');
const zoneRoutes = require('./zoneRoutes');
const router = express.Router();
const districtRoutes = require('./districtRoutes');
const productCatlogRoutes = require('./productCatlogRoutes.js');
const orderRoutes = require('./orderRoutes.js');
const chartRoutes = require('./chartRoutes');

/** GET /health-check - Check service health */
router.get('/health-check', (req, res) => res.send('OK'));

router.use('/auth', authRoutes);
router.use('/batchNumbers', batchnumberRoutes);
router.use('/transaction', transactionRoutes);
router.use('/users', usersRoutes);
router.use('/products', productRoutes);
router.use('/brands', brandRoutes);
router.use('/productOffers', productOffersRoutes);
router.use('/rewardSchemes', rewardSchemesRoutes);
router.use('/transfer', transferRoutes);
router.use('/cashFree', cashFreeRoutes);
router.use('/transactionLedger', transactionLedgerRoutes);
router.use('/states', statesRoutes);
router.use('/zones', zoneRoutes);
router.use('/districts', districtRoutes);
router.use('/productCatlog', productCatlogRoutes);
router.use('/order', orderRoutes);
router.use('/chart', chartRoutes);

module.exports = router;
