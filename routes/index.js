const express = require('express');
const authRoutes = require('./authRoute');
const batchnumberRoutes = require('./batchnumberRoute');
const transactionRoutes = require('./transactionRoutes');
const usersRoutes = require('./usersRoutes');


const router = express.Router();

/** GET /health-check - Check service health */
router.get('/health-check', (req, res) => res.send('OK'));

router.use('/auth', authRoutes);
router.use('/batchNumbers', batchnumberRoutes);
router.use('/transaction', transactionRoutes);
router.use('/users', usersRoutes);


module.exports = router;
