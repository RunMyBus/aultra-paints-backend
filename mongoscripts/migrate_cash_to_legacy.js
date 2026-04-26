/* eslint-disable no-console */
/**
 * mongoscripts/migrate_cash_to_legacy.js
 *
 * One-shot migration: for every User document where `cash` is non-zero,
 * copy the current value into `legacyCash` and reset `cash` to 0.
 *
 * After this migration:
 *   - User.legacyCash  = the balance earned before this migration (read-only)
 *   - User.cash        = 0  (clean slate; new coupon-scan credits accumulate here)
 *
 * The migration uses an aggregation-pipeline update so the copy is done
 * atomically in a single updateMany pass — no application code runs between
 * the read and the write.
 *
 * Idempotent: re-running is safe.  On the second run, every matched document
 * already has cash = 0, so matchedCount will be 0 and nothing changes.
 *
 * Usage:
 *   node mongoscripts/migrate_cash_to_legacy.js
 *
 * Reads MONGO_URI from the environment (or .env via dotenv).
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
    const coll = mongoose.connection.collection('users');

    // ── Pre-migration survey ──────────────────────────────────────────────────
    const [
        totalUsers,
        usersWithCash,
        usersWithLegacyCash,
    ] = await Promise.all([
        coll.countDocuments({}),
        coll.countDocuments({ cash: { $exists: true, $ne: 0 } }),
        coll.countDocuments({ legacyCash: { $exists: true, $ne: 0 } }),
    ]);

    console.log('Pre-migration counts:');
    console.log(`  total users              : ${totalUsers}`);
    console.log(`  users with cash != 0     : ${usersWithCash}   (will be migrated)`);
    console.log(`  users with legacyCash != 0: ${usersWithLegacyCash} (already migrated)`);

    if (usersWithCash === 0) {
        console.log('\nNothing to migrate — all users already have cash = 0.');
        await mongoose.disconnect();
        return;
    }

    // ── Migration ─────────────────────────────────────────────────────────────
    // Aggregation-pipeline update: copies cash → legacyCash atomically, then
    // zeroes cash.  Only touches documents where cash != 0.
    const result = await coll.updateMany(
        { cash: { $exists: true, $ne: 0 } },
        [
            {
                $set: {
                    legacyCash: '$cash',
                    cash: 0,
                },
            },
        ]
    );

    console.log(`\nMigration result: matched=${result.matchedCount}  modified=${result.modifiedCount}`);

    // ── Post-migration survey ─────────────────────────────────────────────────
    const [
        afterUsersWithCash,
        afterUsersWithLegacyCash,
    ] = await Promise.all([
        coll.countDocuments({ cash: { $exists: true, $ne: 0 } }),
        coll.countDocuments({ legacyCash: { $exists: true, $ne: 0 } }),
    ]);

    console.log('\nPost-migration counts:');
    console.log(`  users with cash != 0      : ${afterUsersWithCash}  (expect 0)`);
    console.log(`  users with legacyCash != 0 : ${afterUsersWithLegacyCash}`);

    if (afterUsersWithCash !== 0) {
        console.error('\n⚠️  Some users still have cash != 0. Investigate before deploying.');
        process.exitCode = 2;
    } else {
        console.log('\n✅ Migration complete. All cash balances moved to legacyCash.');
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Migration failed:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
