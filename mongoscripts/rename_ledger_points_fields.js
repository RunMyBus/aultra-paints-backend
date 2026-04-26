/* eslint-disable no-console */
/**
 * mongoscripts/rename_ledger_points_fields.js
 *
 * One-shot migration to rename two fields on the `transactionLedger`
 * collection:
 *
 *   amount  -> pointsCredited
 *   balance -> pointsBalance
 *
 * Run BEFORE deploying the code that consumes the new field names.
 *
 * Usage:
 *   node mongoscripts/rename_ledger_points_fields.js
 *
 * Reads MONGO_URI from the environment (or .env via dotenv).
 *
 * Idempotent: re-running this script is a no-op once all rows have been
 * migrated. Documents that already have the new fields are left alone.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI (or MONGODB_URI) must be set in the environment.');
    process.exit(1);
}

async function main() {
    await mongoose.connect(MONGO_URI);
    const coll = mongoose.connection.collection('transactionLedger');

    // Quick survey
    const totals = await Promise.all([
        coll.countDocuments({}),
        coll.countDocuments({ amount:  { $exists: true } }),
        coll.countDocuments({ balance: { $exists: true } }),
        coll.countDocuments({ pointsCredited: { $exists: true } }),
        coll.countDocuments({ pointsBalance:  { $exists: true } }),
    ]);
    console.log('Pre-migration counts:');
    console.log(`  total rows                     : ${totals[0]}`);
    console.log(`  rows with legacy amount        : ${totals[1]}`);
    console.log(`  rows with legacy balance       : ${totals[2]}`);
    console.log(`  rows with new pointsCredited   : ${totals[3]}`);
    console.log(`  rows with new pointsBalance    : ${totals[4]}`);

    // Atomic rename. $rename is a no-op if the source field is absent on a
    // document, so this is safe to re-run.
    const result = await coll.updateMany(
        {
            $or: [
                { amount:  { $exists: true } },
                { balance: { $exists: true } },
            ],
        },
        {
            $rename: {
                amount:  'pointsCredited',
                balance: 'pointsBalance',
            },
        },
    );
    console.log(`\nMigration result: matched=${result.matchedCount} modified=${result.modifiedCount}`);

    // Post-survey
    const after = await Promise.all([
        coll.countDocuments({ amount:  { $exists: true } }),
        coll.countDocuments({ balance: { $exists: true } }),
        coll.countDocuments({ pointsCredited: { $exists: true } }),
        coll.countDocuments({ pointsBalance:  { $exists: true } }),
    ]);
    console.log('Post-migration counts:');
    console.log(`  rows with legacy amount        : ${after[0]} (expect 0)`);
    console.log(`  rows with legacy balance       : ${after[1]} (expect 0)`);
    console.log(`  rows with new pointsCredited   : ${after[2]}`);
    console.log(`  rows with new pointsBalance    : ${after[3]}`);

    if (after[0] !== 0 || after[1] !== 0) {
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
