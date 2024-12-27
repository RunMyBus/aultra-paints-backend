const passport = require('passport');
const config = process.env;
const LocalStrategy = require('passport-local');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/User');  // Import the User model
const bcrypt = require('bcryptjs');


const localLogin = new LocalStrategy({
        usernameField: 'email',
        passwordField: 'password'
    },
    async (email, password, done) => {
        try {
            // Check if the user exists in the database
            let user = await User.findOne({email: email});
            if (!user) {
                return done( {
                    status: 400,
                    message: 'EMAIL_NOT_FOUND',
                });
            } else {
                const isMatch = await bcrypt.compareSync(password, user.password);
                if (!isMatch) {
                    return done({
                        status: 400,
                        message: 'Invalid Password',
                    });
                }
                return done(null, user);
            }

        } catch (err) {
            return done({status: 400, message: 'Internal Server Error'});
        }

    }
);

const opts = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: 'aultra-paints',
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

passport.use(jwtLogin);
passport.use(localLogin);

module.exports = passport;
