const State = require('../models/stateModel');

// Create a new state
exports.createState = async (req, res) => {
    try {
        const { stateName, stateId } = req.body;

        // Validate fields
        if (!stateName || !stateId) {
            return res.status(400).json({ message: 'State Name and State ID are required.' });
        }

        // Check if stateId or stateName already exists
        const existingState = await State.findOne({
            $or: [{ stateName: stateName.trim() }, { stateId: stateId.trim() }]
        });

        if (existingState) {
            return res.status(400).json({ message: 'State Name or State ID already exists.' });
        }

        const newState = new State({ stateName: stateName.trim(), stateId: stateId.trim() });
        await newState.save();
        return res.status(201).json({ message: 'State created successfully', data: newState });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

// Get all states
exports.getStates = async (req, res) => {
    try {
        const states = await State.find().sort({ stateName: 1 });
        return res.status(200).json({ data: states });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

