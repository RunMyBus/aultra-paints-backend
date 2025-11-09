const TransactionLedger = require('../models/TransactionLedger');
const User = require('../models/User');
const mongoose = require('mongoose');

const Counter = mongoose.model(
  'Counter',
  new mongoose.Schema({
    _id: String,
    sequenceValue: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
  })
);

exports.generateLedgerCode = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error(`User not found for unique code generation (userId: ${userId})`);

  //  Only Dealers generate codes
  if (user.accountType !== 'Dealer' || !user.dealerCode) {
    return null;
  }

  const now = new Date();

  // Build the date part 
  const datePart = now
    .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
    .replace(/\//g, '');

  // Global counter key for all dealers (per day)
  const counterKey = `ledger_seq_${datePart}`;

  //  Atomically increment counter
  let counter = await Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { sequenceValue: 1 }, $setOnInsert: { createdAt: now } },
    { new: true, upsert: true }
  );

  //  If this is a new counter (first use today), verify existing ledgers
  if (counter.sequenceValue === 1) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const lastLedger = await TransactionLedger.findOne({
      narration: {
        $in: [
          "Transferred reward points to Super User",
          "Received reward points from dealer"
        ]
      },
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    })
      .sort({ createdAt: -1 })
      .lean();

    if (lastLedger?.uniqueCode) {
      const parts = lastLedger.uniqueCode.split('_');
      const lastSeq = parseInt(parts[2], 10);

      if (!isNaN(lastSeq) && lastSeq >= 1) {
        counter = await Counter.findByIdAndUpdate(
          counterKey,
          { $set: { sequenceValue: lastSeq + 1 } },
          { new: true }
        );
      }
    }
  }

  const seqNo = counter.sequenceValue;

  // Final unique code
  const finalCode = `${user.dealerCode.trim()}_${datePart}_${seqNo}`;
  return finalCode;
};
