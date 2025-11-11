const CashFreeTransaction = require("../models/CashFreeTransaction");
const { fetchBalance } = require('../services/bulkPePaymentService');

exports.getAllTransactions = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    try {
        const cashFreeTransactions = await CashFreeTransaction.find().skip(skip).limit(limit).sort({createdAt: -1});
        const totalTransactions = await CashFreeTransaction.countDocuments();
        const totalPages = Math.ceil(totalTransactions / limit);
        res.json({
            cashFreeTransactions: cashFreeTransactions,
            pagination: {
                currentPage: page,
                totalPages,
                totalTransactions: totalTransactions,
            },
        });
    } catch (error) {
        res.status(400).json({ error: 'Error fetching cashFree transactions.' });
    }
};

exports.getAvailableBalance = async (req, res) => {
    try {
        const availableBalance = await cashFreeService.fetchBalance();
        res.json({
            success: true,
            availableBalance
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching available balance.',
            error: error.message
        });
    }
};


exports.getAvailableBalance = async (req, res) => {
    try {
        const availableBalance = await fetchBalance(); 
        res.status(200).json({
            success: true,
            availableBalance,
        });
    } catch (error) {
        console.error('Error fetching available balance:', error.message);
        res.status(200).json({
            success: false,
            message: 'Unable to fetch available balance. Please try again later.',
            availableBalance: 0,
        });
    }
};

