const jwt = require("jsonwebtoken");
const User = require('../models/User'); 
const bcrypt = require('bcryptjs');


async function generateToken(user, next) {
    try {
        const token = jwt.sign(user, 'aultra-paints');
        if (user) {
            await User.findByIdAndUpdate(user._id, {token})
        }
        next(token);
    } catch (err) {
        console.error('TOKEN_ERROR:', err);
    }
}

exports.login = async (req, next) => {
    let user = {name: req.user.name, email: req.user.email, _id: req.user._id};
    await generateToken(user, token => {
        next({
            status: 200,
            email: req.user.email,
            id: req.user._id,
            fullName: req.user.name,
            token: token,
            message: "LOGGED_IN_SUCCESSFULLY"
        });
    });
}

exports.register = async (req, next) => {
    const {name, email, password} = req.body;
    try {
        // Check if the user already exists
        let user = await User.findOne({email});
        if (user) {
            return next({status: 400, message: 'User already exists'});
        }

        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create a new user instance
        user = new User({
            name,
            email,
            password: hashedPassword,
        });

        
        await user.save();

        return next({status: 200, message: 'User registered successfully'});
    } catch (err) {
        console.error(err);
        return next({status: 500, message: 'Server error'});
    }
}
