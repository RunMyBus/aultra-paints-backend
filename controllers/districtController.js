const District = require('../models/districtModel');

// Create a new district
exports.createDistrict = async (req, res) => {
    try {
        const { districtName, districtId } = req.body;

        // Validate required fields
        if (!districtName || !districtId) {
            return res.status(400).json({ message: 'District Name and District ID are required.' });
        }

        // Check if districtName or districtId already exists
        const existingDistrict = await District.findOne({
            $or: [{ districtName: districtName.trim() }, { districtId: districtId.trim() }]
        });

        if (existingDistrict) {
            return res.status(400).json({ message: 'District Name or District ID already exists.' });
        }

        // Create and save the new district
        const newDistrict = new District({ districtName: districtName.trim(), districtId: districtId.trim() });
        await newDistrict.save();
        return res.status(201).json({ message: 'District created successfully', data: newDistrict });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

// Get all districts
exports.getAllDistricts = async (req, res) => {
    try {
        const districts = await District.find().sort({ districtName: 1 });
        return res.status(200).json({ data: districts });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};
