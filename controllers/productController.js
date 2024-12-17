const Product = require('../models/Product');

exports.getAllProducts = async (req, res) => {
    try {
      const products = await Product.find();  // Get all products from MongoDB
      res.status(200).json(products); // Send the products as JSON
    } catch (error) {
      res.status(500).json({ error: error.message }); // Handle any errors that occur
    }
  };


  // Create a new product
exports.createProduct = async (req, res) => {
    const { batchNumber, brand, productName, volume, quantity, Branch, expiryDate } = req.body;
  
    const newProduct = new Product({
      batchNumber,
      brand,
      productName,
      volume,
      quantity,
      Branch,
      expiryDate,
    });
  
    try {
      const savedProduct = await newProduct.save(); // Save the new product to MongoDB
      res.status(201).json(savedProduct); // Return the saved product as JSON
    } catch (error) {
      res.status(500).json({ error: error.message }); // Handle any errors that occur
    }
  };