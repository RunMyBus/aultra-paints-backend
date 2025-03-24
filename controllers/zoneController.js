const Zone = require('../models/zoneModel');

// Create a new zone
exports.createZone = async (req, res) => {
    try {
        const { zoneName, zoneId } = req.body;

        // Validate required fields
        if (!zoneName || !zoneId) {
            return res.status(400).json({ message: 'Zone Name and Zone ID are required.' });
        }

        // Check if zoneName or zoneId already exists
        const existingZone = await Zone.findOne({
            $or: [{ zoneName: zoneName.trim() }, { zoneId: zoneId.trim() }]
        });

        if (existingZone) {
            return res.status(400).json({ message: 'Zone Name or Zone ID already exists.' });
        }

        // Create and save the new zone
        const newZone = new Zone({ zoneName: zoneName.trim(), zoneId: zoneId.trim() });
        await newZone.save();
        return res.status(201).json({ message: 'Zone created successfully', data: newZone });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

// Get all zones
exports.getAllZones = async (req, res) => {
    try {
        const zones = await Zone.find().sort({ zoneName: 1 });
        return res.status(200).json({ data: zones });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

