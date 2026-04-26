const mongoose = require('mongoose');

const transactionLedgerSchema = new mongoose.Schema({
    narration: { type: String, required: true },
    // Points track:
    //   pointsCredited = points credited/debited on this row (string preserves
    //                    the legacy '+ NNN' / '- NNN' formatting used by the
    //                    credit-note PDF and other display surfaces; renamed
    //                    from `amount` on 2026-04-26)
    //   pointsBalance  = User.rewardPoints AFTER this row's effect
    //                    (renamed from `balance` on 2026-04-26)
    pointsCredited: { type: String },
    // pointsBalance was `required: true` under the legacy `balance` name;
    // relaxed to optional on 2026-04-26 so cash-only rows (which don't
    // touch User.rewardPoints) don't have to fabricate a points snapshot.
    // Readers should treat undefined as "this row did not affect the
    // points track" — same convention as `cashBalance`.
    pointsBalance:  { type: Number },
    // Cash track (added 2026-04-26 alongside the points+cash redeem flow).
    // Old rows pre-dating this rename are migrated by
    // `mongoscripts/rename_ledger_points_fields.js` so they carry the new
    // field names. Old rows still do not carry the cash fields — readers
    // should treat undefined as "this row did not affect the cash track".
    cashReward:  { type: Number },
    cashBalance: { type: Number },
    userId: { type: String },
    couponId: { type: String },
    uniqueCode: { type: String, unique: true },
    creditNoteIssued: { type: Boolean, default: false }, // prevents double-deduction on repeated credit note downloads
},{ timestamps: true });

module.exports = mongoose.model('TransactionLedger', transactionLedgerSchema, 'transactionLedger');