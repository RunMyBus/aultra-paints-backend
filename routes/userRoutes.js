const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');  // Import the User model
const router = express.Router();

// Secret key from environment variable
const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
    console.error("Error: SECRET_KEY is missing. Please define it in the .env file.");
    process.exit(1);  // Exit the server if SECRET_KEY is not defined
}

// Login Route (Only login functionality, no registration)
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if the user exists in the database
        let user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Verify the password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate a JWT token (excluding the password in the payload)
        const payload = { email: user.email };  // Only include non-sensitive data in the payload
        const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '1h' });

        console.log('Generated Token:', token);  // Log the token to verify if it's generated

        // Send the token in the response (only the token, no password)
        return res.json({ token });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
});

// Registration Route
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Check if the user already exists
        let user = await User.findOne({ email });

        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash the password before saving the user
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create a new user instance
        user = new User({
            name,
            email,
            password: hashedPassword,
        });

        // Save the user to the database
        await user.save();

        return res.status(201).json({ message: 'User registered successfully' });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
