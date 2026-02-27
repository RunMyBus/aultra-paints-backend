const TransactionLedger = require("../models/TransactionLedger");
const Transaction = require("../models/Transaction");
const { generateTransactionLedgerPDF } = require('../utils/pdfGenerator');
const User = require("../models/User");
const { REWARD_SCHEME } = require('../config/rewardConstants');

// GET ALL TRANSACTIONS

exports.getAllTransactions = async (req, res) => {
    const page = parseInt(req.body.page) || 1;
    const limit = parseInt(req.body.limit) || 10;
    const skip = (page - 1) * limit;
    const userId = req.user.id;

    try {
        let query = { userId };

        // Apply transactionType filter if provided
        if (req.body.transactionType) {
            if (req.body.transactionType === 'points') {
                query.narration = { $regex: /points/i };
            } else if (req.body.transactionType === 'cash') {
                query.narration = { $regex: /cash/i };
            }
        }
        
        // Apply coupon code filter if provided
        if (req.body.couponCode) {
            // Aggregation pipeline to convert number to string and apply regex
            const pipeline = [
                {
                    $match: {
                        $expr: {
                            $regexMatch: { 
                                input: { $toString: "$couponCode" }, 
                                regex: req.body.couponCode.toString() 
                            }
                        }
                    }
                }
            ];
            const transaction = await Transaction.aggregate(pipeline);

            if (transaction.length > 0) {
                query.couponId = { $in: transaction.map(i => i._id) };
            } else {
                return res.status(400).json({ error: 'Invalid coupon code.' });
            }
        }

        // Apply date filter if provided
        if (req.body.date) {
            const dateStr = req.body.date;
            const startDate = new Date(dateStr + 'T00:00:00.000Z');
            const endDate = new Date(dateStr + 'T23:59:59.999Z');

            query.createdAt = {
                $gte: startDate,
                $lte: endDate
            };
        }

        // Fetch transactions
        const transactionLedger = await TransactionLedger.find(query)
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 });

        const totalTransactions = await TransactionLedger.countDocuments(query);

        if (totalTransactions === 0) {
            return res.json({ 
                transactions: [], 
                pagination: { 
                    currentPage: page, 
                    totalPages: 0, 
                    totalTransactions: 0 
                } 
            });
        }

      
        //  NEW FEATURE ADDED — dealerName lookup

        for (let txn of transactionLedger) {
            if (
                txn.narration === "Received reward points from dealer" &&
                txn.uniqueCode
            ) {
                // Find dealer-side transaction
                const dealerTxn = await TransactionLedger.findOne({
                    uniqueCode: txn.uniqueCode,
                    narration: "Transferred reward points to Super User"
                });

                if (dealerTxn) {
                    const dealer = await User.findById(dealerTxn.userId).select("name");
                    txn._doc.dealerName = dealer ? dealer.name : "Unknown Dealer";
                } else {
                    txn._doc.dealerName = "Unknown Dealer";
                }
            }
        }

        const totalPages = Math.ceil(totalTransactions / limit);

        res.json({
            transactions: transactionLedger,
            pagination: {
                currentPage: page,
                totalPages,
                totalTransactions,
            },
        });

    } catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Error fetching transactions from ledger.' });
    }
};

exports.generateTransactionLedgerTemplate = async (req, res) => {
  try {
    const transactionLedgerId = req.params.transactionLedgerId;
    console.log('🧾 Generating PDF for ID:', transactionLedgerId);

    const transaction = await TransactionLedger.findById(transactionLedgerId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction ledger entry not found.' });
    }

    let transferorUserId = transaction.userId;
    let txnForPdf = transaction;

    if (
      transaction.narration === 'Received reward points from dealer' &&
      transaction.uniqueCode
    ) {
      // Look up the sender's (dealer's) ledger entry that shares the same uniqueCode
      const senderTxn = await TransactionLedger.findOne({
        uniqueCode: transaction.uniqueCode,
        narration: 'Transferred reward points to Super User',
      });

      if (senderTxn) {
        transferorUserId = senderTxn.userId;
        // Use the dealer's ledger entry so balance is correct (dealer's balance after deduction)
        txnForPdf = senderTxn;
      } else {
        // Fallback: extract dealerCode from uniqueCode and find the user
        const dealerCode = transaction.uniqueCode.split('_')[0];
        if (dealerCode) {
          const dealerUser = await User.findOne({ dealerCode }).select('_id');
          if (dealerUser) {
            transferorUserId = dealerUser._id;
          }
        }
      }
    }

    const transferorUser = await User.findById(transferorUserId).select('name');
    const userName = transferorUser?.name || '';

    // Reward Scheme Calculation for Credit Note (Not saved to DB)
    const amountVal = Math.abs(Number(txnForPdf.amount?.replace(/[^0-9.-]/g, '') || 0));

    // Create a display-friendly version of the transaction (no + or - in amount)
    const displayTxn = {
      ...(txnForPdf.toObject ? txnForPdf.toObject() : txnForPdf),
      amount: amountVal.toString(),
    };

    const transactionsForPdf = [displayTxn];

    if (
      (txnForPdf.narration === 'Transferred reward points to Super User' ||
        txnForPdf.narration === 'Received reward points from dealer') &&
      txnForPdf.uniqueCode
    ) {
      let rewardPoints = 0;
      let rewardPercentage = '0%';

      const scheme = REWARD_SCHEME.find((s) => amountVal === s.threshold);

      if (scheme) {
        rewardPoints = Math.round(amountVal * (scheme.percentage / 100));
        rewardPercentage = `${scheme.percentage}%`;
      }

      if (rewardPoints > 0) {
        displayTxn.rewardPoints = rewardPoints;
        displayTxn.rewardPercentage = rewardPercentage;
      }
    }

    const pdfBuffer = await generateTransactionLedgerPDF(transferorUserId, transactionsForPdf, userName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="CreditNote-${txnForPdf.uniqueCode}.pdf"`
    );
    res.end(pdfBuffer);
  } catch (error) {
    console.error(' Error generating credit note PDF:', error);
    res.status(500).json({ error: 'Failed to generate Credit Note PDF' });
  }
};
