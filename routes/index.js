const express = require('express');
const authRoutes = require('./authRoute');
const batchnumberRoutes = require('./batchnumberRoute');
const transactionRoutes = require('./transactionRoutes');
const usersRoutes = require('./usersRoutes');
const brandRoutes = require('./brandRoutes.js');
const productRoutes = require('./productRoutes.js')
const productOffersRoutes = require('./productOffers.route')
const rewardSchemesRoutes = require('./rewardSchemes.route.js')


const router = express.Router();

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


module.exports = router;
