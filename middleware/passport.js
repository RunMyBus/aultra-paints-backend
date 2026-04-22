const passport = require('passport');
const config = process.env;
const LocalStrategy = require('passport-local');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/User');
const UserLoginSMSModel = require("../models/UserLoginSMS");
const StaticPhoneNumbers = require('../models/staticPhoneNumbers');
const { JWT_SECRET } = require('../config/secrets');

// Static OTP bypass — controlled purely by STATIC_OTP_ENABLED env var (set to 'true' to enable).
// Applies to whitelisted numbers in the StaticPhoneNumbers collection, in any environment.
const STATIC_OTP_ENABLED = process.env.STATIC_OTP_ENABLED === 'true';
const STATIC_OTP = String(process.env.STATIC_OTP || 123456);

const localLogin = new LocalStrategy({usernameField: 'mobile', passwordField: 'otp'}, async (mobile, otp, done) => {
    if (!mobile || !otp) {
        return done.status(400).json({ error: 'Mobile number and OTP are required' });
    }
    try {
        let user = await User.findOne({mobile: mobile});
        if (!user) {
            return done({status: 400, message: 'MOBILE NOT FOUND'});
        } else {
            const staticPhoneNumbers = STATIC_OTP_ENABLED ? await StaticPhoneNumbers.find() : [];
            const mobileNumbers = staticPhoneNumbers.map(doc => doc.mobile);

            if (STATIC_OTP_ENABLED && mobileNumbers.includes(mobile)) {
                if (String(otp) === STATIC_OTP) {
                    return done(null, user);
                } else {
                    return done({status: 400, message: 'INVALID OTP'});
                }
            } else {
                const otpRecord = await UserLoginSMSModel.findOne({ mobile: mobile, otp , active: true });
                if (!otpRecord) {
                    return done({status: 404, message: 'INVALID OTP'});
                }

                if (new Date() > otpRecord.expiryTime) {
                    otpRecord.active = false;
                    await otpRecord.save();
                    return done({status: 400, message: 'OTP EXPIRED'});
                }
                otpRecord.active = false;
                await otpRecord.save();
                return done(null, user);
            }
        }
    } catch (error) {
        console.error("Error verifying OTP:", error);
        return done({status: 500, message: 'Failed to verify OTP'});
    }
});

const opts = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: JWT_SECRET,
};

const jwtLogin = new JwtStrategy(
    {...opts, passReqToCallback: true},
    async (req, jwtPayload, done) => {
        try {
            let user = await User.findOne({_id: jwtPayload._id});
            if (user) {
                const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
                if (user.token === token) {
                    return done(null, user);
                } else {
                    return done(null, false, {message: 'Token mismatch'});
                }
            } else {
                return done(null, false, {message: 'User not found'});
            }
        } catch (err) {
            return done(err, false);
        }
    }
);

passport.serializeUser((user, done) => {
    done(null, user._id);
});

passport.deserializeUser((id, done) => {
    User.findById(id, (err, user) => {
        done(err, user);
    });
});

passport.use(jwtLogin);
passport.use(localLogin);

module.exports = passport;