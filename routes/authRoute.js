const express = require('express');
const router = express.Router();
const passport = require('passport');
const { rateLimit, byMobileOrIp, byIp } = require('../middleware/rateLimit');

const AuthController = require('../controllers/authController')

// Rate limits: protect against SMS bombing (cost DoS) and OTP brute force.
const otpSendLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1 hour
    max: 5,                      // 5 OTP sends per mobile per hour
    keyFn: byMobileOrIp,
    message: 'Too many OTP requests. Please try again after an hour.',
});
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 10,                     // 10 verify attempts per mobile per 15m
    keyFn: byMobileOrIp,
    message: 'Too many verification attempts. Please wait and try again.',
});
const redeemLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyFn: byIp,
    message: 'Too many redemption attempts. Please wait and try again.',
});


router.post('/login', otpVerifyLimiter, passport.authenticate('local', {session: true}), async (req, res) => {
    await AuthController.login(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/verifyOTP', otpVerifyLimiter, passport.authenticate('local', {session: true}), async (req, res) => {
    await AuthController.login(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/loginWithOTP', otpSendLimiter, async (req, res) => {
    await AuthController.loginWithOTP(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/register', otpSendLimiter, async (req, res) => {
    await AuthController.register(req, result => {
        res.status(result.status).json(result);
    })
});

router.post('/redeem/:qrCodeID', redeemLimiter, async (req, res) => {
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
