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

// Controller function to get all products with pagination
const getProducts = async (req, res) => {
  const page = parseInt(req.query.page) || 1;  
  const limit = parseInt(req.query.limit) || 10;  

  // Calculate how many products to skip based on the current page
  const skip = (page - 1) * limit;

  try {
    const products = await Product.find().skip(skip).limit(limit);
    const totalProducts = await Product.countDocuments();
    const totalPages = Math.ceil(totalProducts / limit);
    res.json({
      products,  
      pagination: {
        currentPage: page,  
        totalPages,  
        totalProducts,  
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Error fetching products' });
  }
};


// Get a product by its name
const getProductByName = async (req, res) => {
  const { name } = req.params;

  try {
    const product = await Product.findOne({ name: new RegExp(name, 'i') }); // Using regex for case-insensitive search
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (error) {
    res.status(400).json({ error: 'Error fetching product by name' });
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

getAllProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.status(200).json(products);
  } catch (error) {
    res.status(400).json({ error: 'Error fetching products' });
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductByName,
  updateProduct,
  deleteProduct,
  getAllProducts
};
