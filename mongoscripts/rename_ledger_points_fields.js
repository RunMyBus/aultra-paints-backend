/* eslint-disable no-console */
/**
 * mongoscripts/rename_ledger_points_fields.js
 *
 * One-shot migration to rename two legacy fields on the `transactionLedger`
 * collection.  The `narration` value is used to distinguish record types:
 *
 *   /redeemed points/i  →  points transactions
 *     amount  → pointsCredited   (String, e.g. "+ 50" / "- 50")
 *     balance → pointsBalance    (Number, User.rewardPoints after this row)
 *
 *   /redeemed cash/i    →  cash transactions
 *     amount  → cashReward       (Number)
 *     balance → cashBalance      (Number, User.cash after this row)
 *
 * Records that match neither pattern but still carry the legacy fields are
 * treated as points transactions (all other narrations — transfers, credit-note
 * deductions, etc. — are reward-points operations).  They are migrated in the
 * same pass and a count is printed so they can be reviewed.
 *
 * Run BEFORE deploying the code that consumes the new field names.
 *
 * Usage:
 *   node mongoscripts/rename_ledger_points_fields.js
 *
 * Reads MONGO_URI from the environment (or .env via dotenv).
 *
 * Idempotent: re-running is a no-op once all rows have been migrated.
 * MongoDB's $rename is a no-op when the source field is absent on a document.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI (or MONGODB_URI) must be set in the environment.');
    process.exit(1);
}

const POINTS_NARRATION = /redeemed points/i;
const CASH_NARRATION   = /redeemed cash/i;

// Helper: count documents matching a query
const count = (coll, q) => coll.countDocuments(q);

// Legacy-field existence filter (either field may be absent on a given doc)
const legacyExists = {
    $or: [
        { amount:  { $exists: true } },
        { balance: { $exists: true } },
    ],
};

async function main() {
    await mongoose.connect(MONGO_URI);
    const coll = mongoose.connection.collection('transactionLedger');

    // ── Pre-migration survey ──────────────────────────────────────────────────
    const [
        total,
        legacyPointsAmount,
        legacyPointsBalance,
        legacyCashAmount,
        legacyCashBalance,
        legacyOtherAmount,
        legacyOtherBalance,
        newPointsCredited,
        newPointsBalance,
        newCashReward,
        newCashBalance,
    ] = await Promise.all([
        count(coll, {}),
        count(coll, { narration: POINTS_NARRATION, amount:  { $exists: true } }),
        count(coll, { narration: POINTS_NARRATION, balance: { $exists: true } }),
        count(coll, { narration: CASH_NARRATION,   amount:  { $exists: true } }),
        count(coll, { narration: CASH_NARRATION,   balance: { $exists: true } }),
        count(coll, { $nor: [{ narration: POINTS_NARRATION }, { narration: CASH_NARRATION }], amount:  { $exists: true } }),
        count(coll, { $nor: [{ narration: POINTS_NARRATION }, { narration: CASH_NARRATION }], balance: { $exists: true } }),
        count(coll, { pointsCredited: { $exists: true } }),
        count(coll, { pointsBalance:  { $exists: true } }),
        count(coll, { cashReward:     { $exists: true } }),
        count(coll, { cashBalance:    { $exists: true } }),
    ]);

    console.log('Pre-migration counts:');
    console.log(`  total rows                              : ${total}`);
    console.log(`  --- legacy "amount" / "balance" fields ---`);
    console.log(`  points rows   legacy amount             : ${legacyPointsAmount}`);
    console.log(`  points rows   legacy balance            : ${legacyPointsBalance}`);
    console.log(`  cash rows     legacy amount             : ${legacyCashAmount}`);
    console.log(`  cash rows     legacy balance            : ${legacyCashBalance}`);
    console.log(`  other rows    legacy amount             : ${legacyOtherAmount}  (will be treated as points)`);
    console.log(`  other rows    legacy balance            : ${legacyOtherBalance} (will be treated as points)`);
    console.log(`  --- current field names ---`);
    console.log(`  rows with pointsCredited                : ${newPointsCredited}`);
    console.log(`  rows with pointsBalance                 : ${newPointsBalance}`);
    console.log(`  rows with cashReward                    : ${newCashReward}`);
    console.log(`  rows with cashBalance                   : ${newCashBalance}`);

    // ── Migration ─────────────────────────────────────────────────────────────

    // Pass 1: points records — narration matches /redeemed points/i
    const pointsResult = await coll.updateMany(
        {
            narration: POINTS_NARRATION,
            ...legacyExists,
        },
        {
            $rename: {
                amount:  'pointsCredited',
                balance: 'pointsBalance',
            },
        },
    );
    console.log(`\nPoints migration:  matched=${pointsResult.matchedCount}  modified=${pointsResult.modifiedCount}`);

    // Pass 2: cash records — narration matches /redeemed cash/i
    const cashResult = await coll.updateMany(
        {
            narration: CASH_NARRATION,
            ...legacyExists,
        },
        {
            $rename: {
                amount:  'cashReward',
                balance: 'cashBalance',
            },
        },
    );
    console.log(`Cash   migration:  matched=${cashResult.matchedCount}  modified=${cashResult.modifiedCount}`);

    // Pass 3: all other legacy records (transfers, credit-note deductions, …)
    // These are all points-type operations — rename the same way as Pass 1.
    const otherResult = await coll.updateMany(
        {
            narration: { $not: CASH_NARRATION },
            ...legacyExists,
        },
        {
            $rename: {
                amount:  'pointsCredited',
                balance: 'pointsBalance',
            },
        },
    );
    console.log(`Other  migration:  matched=${otherResult.matchedCount}  modified=${otherResult.modifiedCount}`);

    // ── Post-migration survey ─────────────────────────────────────────────────
    const [
        afterLegacyAmount,
        afterLegacyBalance,
        afterPointsCredited,
        afterPointsBalance,
        afterCashReward,
        afterCashBalance,
    ] = await Promise.all([
        count(coll, { amount:          { $exists: true } }),
        count(coll, { balance:         { $exists: true } }),
        count(coll, { pointsCredited:  { $exists: true } }),
        count(coll, { pointsBalance:   { $exists: true } }),
        count(coll, { cashReward:      { $exists: true } }),
        count(coll, { cashBalance:     { $exists: true } }),
    ]);

    console.log('\nPost-migration counts:');
    console.log(`  rows with legacy amount                 : ${afterLegacyAmount}  (expect 0)`);
    console.log(`  rows with legacy balance                : ${afterLegacyBalance} (expect 0)`);
    console.log(`  rows with pointsCredited                : ${afterPointsCredited}`);
    console.log(`  rows with pointsBalance                 : ${afterPointsBalance}`);
    console.log(`  rows with cashReward                    : ${afterCashReward}`);
    console.log(`  rows with cashBalance                   : ${afterCashBalance}`);

    if (afterLegacyAmount !== 0 || afterLegacyBalance !== 0) {
        console.error('\n⚠️  Some rows still carry the legacy field names. Investigate before deploying new code.');
        process.exitCode = 2;
    } else {
        console.log('\n✅ All rows migrated.');
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Migration failed:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
