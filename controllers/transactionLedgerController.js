const TransactionLedger = require("../models/TransactionLedger");
exports.getAllTransactions = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    try {
        const transactionLedger = await TransactionLedger.find().skip(skip).limit(limit).sort({createdAt: -1});
        const totalTransactions = await TransactionLedger.countDocuments();
        const totalPages = Math.ceil(totalTransactions / limit);
        res.json({
            transactions: transactionLedger,
            pagination: {
                currentPage: page,
                totalPages,
                totalTransactions: totalTransactions,
            },
        });
    } catch (error) {
        res.status(400).json({ error: 'Error fetching transactions from ledger.' });
    }
};