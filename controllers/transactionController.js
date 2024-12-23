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
        // Find the transaction and update isProcessed to true
        const updatedTransaction = await Transaction.findOneAndUpdate(
            { qr_code: qr },  // Match the QR code
            { isProcessed: true },  // Update isProcessed to true
            { new: true }  // Return the updated document
        );

        if (!updatedTransaction) {
            return res.status(404).json({ message: 'Transaction not found.' });
        }

        res.status(200).json(updatedTransaction);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};