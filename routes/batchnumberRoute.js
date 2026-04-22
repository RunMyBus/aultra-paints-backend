const express = require('express');
const router = express.Router();
const batchnumberController = require('../controllers/batchnumberController');
const passport = require("passport");
const { requireRole, ADMIN } = require('../middleware/authorize');

router.use(passport.authenticate('jwt', { session: false }));

router.post('/', requireRole(ADMIN), batchnumberController.getAllBatchNumbers);
router.get('batch/:BatchNumber', requireRole(ADMIN), batchnumberController.getBranchByBatchNumber);
router.post('/add', requireRole(ADMIN), batchnumberController.createBatchNumberWithCouponCheck);
router.post('/uploadAudio', requireRole(ADMIN), batchnumberController.uploadAudioToS3);
router.put('/update/:id', requireRole(ADMIN), batchnumberController.updateBatchNumber);
router.get('/branchDeletedAffectedCouponsCount/:id', requireRole(ADMIN), batchnumberController.branchDeletedAffectedCouponsCount);
router.delete('/delete/:id', requireRole(ADMIN), batchnumberController.deleteBranchByBatchNumber);
router.get('/couponSeries', requireRole(ADMIN), batchnumberController.getCouponSeries);

module.exports = router;
