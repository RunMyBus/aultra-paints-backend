const express = require('express');
const router = express.Router();
const passport = require('passport');

const AuthController = require('../controllers/authController')


router.post('/login', passport.authenticate('local', {session: true}), async (req, res) => {
    await AuthController.login(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/verifyOTP', passport.authenticate('local', {session: true}), async (req, res) => {
    await AuthController.login(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/loginWithOTP', async (req, res) => {
    await AuthController.loginWithOTP(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/register', async (req, res) => {
    await AuthController.register(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/redeem/:qrCodeID', async (req, res) => {
    await AuthController.redeemCash(req, result => {
        res.status(result.status).json(result);
    });
});

router.post('/sms', async (req, res) => {
    await AuthController.smsFunction(req, result => {
        res.status(result.status).json(result);
    });
});

module.exports = router;
