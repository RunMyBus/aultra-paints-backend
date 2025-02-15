const TransactionLedger = require("../models/TransactionLedger");
const Transaction = require("../models/Transaction");
exports.getAllTransactions = async (req, res) => {
    const page = parseInt(req.body.page) || 1;
    const limit = parseInt(req.body.limit) || 10;
    const skip = (page - 1) * limit;
    const userId = req.user.id;

    try {
        let query = { userId };
        // Apply coupon code filter if provided
        if (req.body.couponCode) {
            // Aggregation pipeline to convert number to string and apply regex
            const pipeline = [
                {
                    $match: {
                        $expr: {
                            $regexMatch: { input: { $toString: "$couponCode" }, regex: req.body.couponCode.toString() }
                        }
                    }
                }
            ];
            const transaction = await Transaction.aggregate(pipeline);
            //const transaction = await Transaction.findOne({ couponCode: req.body.couponCode });
            if (transaction.length > 0) {
                query.couponId = {$in: transaction.map(i => i._id)};
            }else {
                return res.status(400).json({ error: 'Invalid coupon code.' });
            }
        }
        // Apply date filter if provided
        if (req.body.date) {
            // Expecting date in format YYYY-MM-DD
            const dateStr = req.body.date;
            const startDate = new Date(dateStr + 'T00:00:00.000Z');
            const endDate = new Date(dateStr + 'T23:59:59.999Z');

            query.createdAt = {
                $gte: startDate,
                $lte: endDate
            };
        }

        const transactionLedger = await TransactionLedger.find(query)
            .skip(skip)
            .limit(limit)
            .sort({createdAt: -1});

        const totalTransactions = await TransactionLedger.countDocuments(query);
        if (totalTransactions === 0) {
            return res.status(400).json({ error: 'No transactions found.' });
        }
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