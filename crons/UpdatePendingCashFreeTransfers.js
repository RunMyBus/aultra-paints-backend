const cron = require('node-cron');
const cashFreePaymentService = require('../services/cashFreePaymentService');
const CashFreeTransaction = require('../models/CashFreeTransaction');
const config = process.env;

// In-memory tracker for pending transactions and their retry counts
const pendingTransactionTracker = new Map();

const processPendingTransactions = async () => {
    try {
        console.log('Cron Job Started: Fetching pending transactions...');

        // Fetch all transactions with status "PENDING"
        const pendingTransactions = await CashFreeTransaction.find({
            status: { $in: ["PENDING", "RECEIVED"] }
        });

        if (!pendingTransactions.length) {
            console.log('No pending transactions found.');
        }

        for (const transaction of pendingTransactions) {
            const { transfer_id } = transaction;

            // Check the retry count from the tracker
            const retryCount = pendingTransactionTracker.get(transfer_id) || 0;

            // Call checkTransferStatus
            const transferStatus = await cashFreePaymentService.checkTransferStatus(transfer_id);

            if (transferStatus.data.status === "SUCCESS" && transferStatus.data.status_code === "COMPLETED") {
                console.log(`Transfer Successful for ID: ${transfer_id}`);
                // Update the transaction with success status
                await cashFreePaymentService.updateToDB(transferStatus);
                // Remove from tracker
                pendingTransactionTracker.delete(transfer_id);
            } else if (transferStatus.data.status === "REJECTED") {
                console.log(`Transfer Rejected for ID: ${transfer_id}`);
                // Update the transaction with rejected status
                await cashFreePaymentService.updateToDB(transferStatus);
                // Remove from tracker
                pendingTransactionTracker.delete(transfer_id);
            } else if (retryCount >= 2) {
                console.log(`Marking transaction as Failed for ID: ${transfer_id}`);
                // Update the transaction with failed status
                await CashFreeTransaction.findOneAndUpdate(
                    { transfer_id },
                    { $set: { status: "FAILED", status_description: "Marked as failed after retries" } },
                    { new: true }
                );
                // Remove from tracker
                pendingTransactionTracker.delete(transfer_id);
            } else {
                console.log(`Transaction still pending for ID: ${transfer_id}. Incrementing retry count.`);
                // Increment the retry count
                pendingTransactionTracker.set(transfer_id, retryCount + 1);
            }
        }
    } catch (error) {
        console.error('Error processing pending transactions:', error);
    }
};

// Schedule the cron job to run every 30 minutes
cron.schedule('*/30 * * * *', async () => {
    console.log('config ------ ', config.RUN_SCHEDULER_JOB);
    if (config.RUN_SCHEDULER_JOB === "true") {
        console.log('Cron Job Executed:', new Date());
        await processPendingTransactions();
    }
});

console.log('Cron Job Scheduled: Runs every 30 minutes.');

// setInterval(() => {}, 1000 * 60 * 60); // Keeps the process alive