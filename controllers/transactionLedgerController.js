const TransactionLedger = require("../models/TransactionLedger");
const Transaction = require("../models/Transaction");
// const AWS = require('aws-sdk');
// const multer = require('multer');
// const multerS3 = require('multer-s3');
const { generateTransactionLedgerPDF } = require('../utils/pdfGenerator');
const User = require("../models/User");


// function decodeBase64File(dataString) {
//   try {
//     const matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
//     if (!matches || matches.length !== 3) {
//       throw new Error('Invalid base64 file data');
//     }

//     return {
//       type: matches[1],
//       data: Buffer.from(matches[2], 'base64'),
//     };
//   } catch (err) {
//     return new Error('Invalid base64 data');
//   }
// }


// // AWS S3 Setup
// const s3 = new AWS.S3({
//   region: process.env.AWS_REGION,
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
// });


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


//Update Transaction Ledger 
// exports.updateTransactionLedger = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.id;

//     const {
//       narration,
//       amount,
//       balance,
//       couponId,
//       uniqueCode,
//       file, 
//     } = req.body;

//     // Find the ledger record
//     const existingLedger = await TransactionLedger.findOne({ _id: id, userId });
//     if (!existingLedger) {
//       return res.status(404).json({ error: 'Transaction ledger not found for this user.' });
//     }

//     // Update standard fields dynamically
//     if (narration !== undefined) existingLedger.narration = narration;
//     if (amount !== undefined) existingLedger.amount = amount;
//     if (balance !== undefined) existingLedger.balance = balance;
//     if (couponId !== undefined) existingLedger.couponId = couponId;
//     if (uniqueCode !== undefined) existingLedger.uniqueCode = uniqueCode;

//     //  Upload new PDF to S3 (if provided)
//     if (file) {
//       const fileData = decodeBase64File(file);
//       if (fileData instanceof Error) {
//         return res.status(400).json({ message: 'Invalid PDF file data.' });
//       }

//       // Ensure the uploaded file is a PDF
//       if (fileData.type !== 'application/pdf') {
//         return res.status(400).json({ message: 'Only PDF files are allowed.' });
//       }

//       //  Upload the file to AWS S3
//       const params = {
//         Bucket: process.env.AWS_BUCKET_TRANSACTION_LEDGER,
//         Key: `TransactionLedger/${existingLedger._id}.pdf`,
//         Body: fileData.data,
//         ContentType: fileData.type,
//         ACL: 'public-read',
//       };

//       const uploadResult = await s3.upload(params).promise();
//       existingLedger.fileUrl = uploadResult.Location;
//     }

//     //  Save the updated document
//     await existingLedger.save();

//     res.json({
//       message: 'Transaction ledger updated successfully.',
//       transaction: existingLedger,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Error updating transaction ledger.' });
//   }
// };

exports.generateTransactionLedgerTemplate = async (req, res) => {
  try {
    const transactionLedgerId = req.params.transactionLedgerId;
    console.log('🧾 Generating PDF for ID:', transactionLedgerId);

    const transaction = await TransactionLedger.findById(transactionLedgerId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction ledger entry not found.' });
    }

    let transferorUserId = transaction.userId;

    if (
      transaction.narration === 'Received reward points from dealer' &&
      transaction.uniqueCode
    ) {
      // Look up the sender's (dealer's) ledger entry that shares the same uniqueCode
      const senderTxn = await TransactionLedger.findOne({
        uniqueCode: transaction.uniqueCode,
        narration: 'Transferred reward points to Super User',
      }).select('userId');

      if (senderTxn) {
        transferorUserId = senderTxn.userId;
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

    //  Always wrap in array for the PDF generator
    const pdfBuffer = await generateTransactionLedgerPDF(transferorUserId, [transaction], userName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="CreditNote-${transaction.uniqueCode}.pdf"`
    );
    res.end(pdfBuffer);
  } catch (error) {
    console.error(' Error generating credit note PDF:', error);
    res.status(500).json({ error: 'Failed to generate Credit Note PDF' });
  }
};
