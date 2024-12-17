require('dotenv').config();  // Load environment variables from .env file
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Import routes
const authRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');

// Create an instance of Express
const app = express();
const port = 3000;

// Connect to MongoDB using Mongoose
mongoose.connect(process.env.MONGODB_URI)  // No need for deprecated options
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(cors());
app.use(bodyParser.json());  // Parse JSON request bodies
app.use(bodyParser.urlencoded({ extended: true }));

// Use authentication routes
app.use('/api', authRoutes);

app.use('/api', orderRoutes);


// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
