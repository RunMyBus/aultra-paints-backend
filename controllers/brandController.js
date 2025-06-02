const Brand = require('../models/Brand');  // Import the new Brand model

// Create a new brand
const createBrand = async (req, res) => {
  const { name } = req.body;

  try {
    const existingBrand = await Brand.findOne({ name });

    if (existingBrand) {
      return res.status(400).json({ error: 'This brand name already exists.' });
    }

    const newBrand = new Brand({ name });
    await newBrand.save();
    res.status(201).json(newBrand);

  } catch (error) {
    res.status(400).json({ error: 'Error creating brand' });
  }
};

// Get all brands with pagination
const getBrands = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    const brands = await Brand.find().skip(skip).limit(limit);
    const totalBrands = await Brand.countDocuments();
    const totalPages = Math.ceil(totalBrands / limit);

    res.json({
      brands,
      pagination: {
        currentPage: page,
        totalPages,
        totalBrands,
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Error fetching brands' });
  }
};

// Get brands by name (with pagination)
const getBrandByName = async (req, res) => {
  const { name } = req.params;
  let page = parseInt(req.query.page || 1);
  let limit = parseInt(req.query.limit || 10);

  try {
    let query = {};
    if (name) {
      query.name = { $regex: new RegExp(name, 'i') };
    }

    const brands = await Brand.find(query)
      .skip((page - 1) * limit)
      .limit(limit);

    const totalBrands = await Brand.countDocuments(query);

    if (brands.length === 0) {
      return res.status(404).json({ error: 'No brands found matching that name' });
    }

    return res.status(200).json({
      status: 200,
      data: brands,
      total: totalBrands,
      pages: Math.ceil(totalBrands / limit),
      currentPage: page,
    });

  } catch (error) {
    return res.status(500).json({ error: 'Error fetching brands by name' });
  }
};

// Update brand by ID
const updateBrand = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const existingBrand = await Brand.findOne({ name });
    if (existingBrand && existingBrand._id.toString() !== brand._id.toString()) {
      return res.status(400).json({ error: 'This brand name already exists.' });
    }

    if (brand.name === name) {
      return res.status(200).json(brand);
    }

    const updatedBrand = await Brand.findByIdAndUpdate(id, { name }, { new: true });

    if (!updatedBrand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.status(200).json(updatedBrand);
  } catch (error) {
    console.error('Error updating brand:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete brand by ID
const deleteBrand = async (req, res) => {
  const { id } = req.params;

  try {
    const deletedBrand = await Brand.findByIdAndDelete(id);
    if (!deletedBrand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.status(200).json({ message: 'Brand deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Error deleting brand' });
  }
};

// Get all brands without pagination
const getAllBrands = async (req, res) => {
  try {
    const brands = await Brand.find();
    res.status(200).json(brands);
  } catch (error) {
    res.status(400).json({ error: 'Error fetching brands' });
  }
};

module.exports = {
  createBrand,
  getBrands,
  getBrandByName,
  updateBrand,
  deleteBrand,
  getAllBrands,
};
