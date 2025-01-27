const CashFreeTransaction = require("../models/CashFreeTransaction");
exports.getAllTransactions = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    try {
        const cashFreeTransactions = await CashFreeTransaction.find().skip(skip).limit(limit);
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
        res.status(400).json({ error: 'Error fetching products' });
    }
};