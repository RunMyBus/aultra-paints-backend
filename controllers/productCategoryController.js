const ProductCategory = require('../models/ProductCategory');

exports.createProductCategory = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Category name is required.' });
        }
        const existing = await ProductCategory.findOne({ name: name.trim() });
        if (existing) {
            return res.status(400).json({ message: 'Category name already exists.' });
        }
        const category = new ProductCategory({ name: name.trim() });
        await category.save();
        return res.status(201).json({ message: 'Product category created successfully', data: category });
    } catch (err) {
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

exports.getProductCategories = async (req, res) => {
    try {
        const categories = await ProductCategory.find().sort({ name: 1 });
        return res.status(200).json({ data: categories });
    } catch (err) {
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

exports.updateProductCategory = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Category name is required.' });
        }
        const existing = await ProductCategory.findOne({
            name: name.trim(),
            _id: { $ne: req.params.id }
        });
        if (existing) {
            return res.status(400).json({ message: 'Category name already exists.' });
        }
        const category = await ProductCategory.findByIdAndUpdate(
            req.params.id,
            { name: name.trim() },
            { new: true }
        );
        if (!category) {
            return res.status(404).json({ message: 'Product category not found.' });
        }
        return res.status(200).json({ message: 'Product category updated successfully', data: category });
    } catch (err) {
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

exports.deleteProductCategory = async (req, res) => {
    try {
        const category = await ProductCategory.findByIdAndDelete(req.params.id);
        if (!category) {
            return res.status(404).json({ message: 'Product category not found.' });
        }
        return res.status(200).json({ message: 'Product category deleted successfully' });
    } catch (err) {
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};
