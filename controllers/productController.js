const Product = require('../models/Product');

// Create a new product
const createProduct = async (req, res) => {
  const { name } = req.body;  

  try {
    const newProduct = new Product({ name });
    await newProduct.save();  
    res.status(201).json(newProduct); 
  } catch (error) {
    res.status(400).json({ error: 'Error creating product' });
  }
};

// Get all products
const getProducts = async (req, res) => {
  try {
    const products = await Product.find(); 
    res.status(200).json(products);  
  } catch (error) {
    res.status(400).json({ error: 'Error fetching products' });
  }
};

// Get a specific product by its ID
const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const product = await Product.findById(id);  
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);  
  } catch (error) {
    res.status(400).json({ error: 'Error fetching product' });
  }
};

// Update a product by its ID
const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    const updatedProduct = await Product.findByIdAndUpdate(id, { name }, { new: true });  
    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(updatedProduct); 
  } catch (error) {
    res.status(400).json({ error: 'Error updating product' });
  }
};

// Delete a product by its ID
const deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const deletedProduct = await Product.findByIdAndDelete(id);  
    if (!deletedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted successfully' });  
  } catch (error) {
    res.status(400).json({ error: 'Error deleting product' });
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
