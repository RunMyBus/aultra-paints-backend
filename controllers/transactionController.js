const Transaction = require('../models/Transaction');

exports.getAllTransactionsForBatch = async (req, res) => {
    const { batchId } = req.params;

    try {
        const transactions = await Transaction.find({ batchId: batchId });

        if (transactions.length === 0) {
            return res.status(404).json({ message: 'No transactions found for this batch.' });
        }
        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json({ error: error.message });  // Handle any errors that occur
    }
};

exports.markTransactionAsProcessed = async (req, res) => {
    const { qr } = req.params;  // Assuming qr is passed as a URL parameter

    try {
        const updatedTransaction = await Transaction.findOneAndUpdate(
            { qr: qr },
            { isProcessed: true },  // Update isProcessed to true
            { new: true }
        );

        if (!updatedTransaction) {
            return res.status(404).json({ message: 'Transaction not found.' });
        }

        res.status(200).json(updatedTransaction);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};