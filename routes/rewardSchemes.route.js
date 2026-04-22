const express = require('express');
const router = express.Router();
const rewardSchemesController = require('../controllers/rewardSchemes.controller');
const passport = require("passport");
const multer = require('multer');
const upload = multer({
    limits: { fieldSize: 4 * 1024 * 1024 }, // Maximum size of a single form field (2 MB)
});

router.use(passport.authenticate('jwt', { session: false }));
const { requireRole, ADMIN } = require('../middleware/authorize');

router.post('/create', requireRole(ADMIN), upload.none(), rewardSchemesController.createRewardScheme);
router.post('/searchRewardSchemes', requireRole(ADMIN), rewardSchemesController.searchRewardSchemes);
router.get('/getRewardSchemes', rewardSchemesController.getRewardSchemes);
router.get('/getRewardSchemeById/:id', rewardSchemesController.getRewardSchemeById);
router.put('/update/:id', requireRole(ADMIN), upload.single('file'), rewardSchemesController.updateRewardScheme);
router.delete('/delete/:id', requireRole(ADMIN), rewardSchemesController.deleteRewardScheme);

module.exports = router;