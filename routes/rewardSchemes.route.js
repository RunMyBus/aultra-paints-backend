const express = require('express');
const router = express.Router();
const rewardSchemesController = require('../controllers/rewardSchemes.controller');
const passport = require("passport");
const multer = require('multer');
const upload = multer();

router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', upload.none(), rewardSchemesController.createRewardScheme);
router.post('/searchRewardSchemes', rewardSchemesController.searchRewardSchemes);
router.get('/getRewardSchemes', rewardSchemesController.getRewardSchemes);
router.get('/getRewardSchemeById/:id', rewardSchemesController.getRewardSchemeById);
router.put('/update/:id', upload.none(), rewardSchemesController.updateRewardScheme);
router.delete('/delete/:id', rewardSchemesController.deleteRewardScheme);

module.exports = router;