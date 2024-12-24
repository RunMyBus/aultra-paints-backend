const Transaction = require('../models/Transaction');

exports.getAllTransactionsForBatch = async (req, res) => {
    console.log(req.body)
    const { batchId } = req.body;
    let query = {};
    if (batchId)
        query.batchId = new ObjectId(batchId);
    try {
        const transactions = await Transaction.find(query).sort({ createdAt: -1 })
            .populate('updatedBy', 'name') // Populate updatedBy with username
            .populate('createdBy', 'name'); // Populate createdBy with username;

        if (transactions.length === 0) {
            return res.status(404).json({ message: 'No transactions found for this batch.' });
        }
        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json({ error: error.message });  // Handle any errors that occur
    }
};

exports.markTransactionAsProcessed = async (req, res) => {
    console.log(req.user)
    const { qr } = req.params;  // Assuming qr is passed as a URL parameter

    try {
        const document = await Transaction.findOne({ qr_code_id:  qr });
        if(document.isProcessed) {
            return res.status(404).json({ message: 'Coupon Redeemed already.' });
        }else {
            // Find the transaction and update isProcessed to true
            const updatedTransaction = await Transaction.findOneAndUpdate(
                {qr_code_id: qr},  // Match the QR code
                {isProcessed: true, updatedBy: req.user._id},  // Update isProcessed to true
                {new: true}  // Return the updated document
            );

            if (!updatedTransaction) {
                return res.status(404).json({message: 'Transaction not found.'});
            }

            res.status(200).json({message: "Coupon redeemed Successfully..!"});
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
