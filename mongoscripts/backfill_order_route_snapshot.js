/* eslint-disable no-console */
/**
 * mongoscripts/backfill_order_route_snapshot.js
 *
 * One-shot backfill for the order route/salesman DISPLAY snapshot introduced in
 * the "Dealer route mapping + order route/salesman snapshot" change.
 *
 * New orders capture these at creation/sync time:
 *   - routeName            (the route the order was placed on, e.g. R-A)
 *   - salesExecutiveMobile (the actual salesman's / S-A mobile)
 *
 * Legacy orders predate those fields and have them empty. `getOrderDetails`
 * already falls back to the dealer's CURRENT mapping, so nothing is visibly
 * broken — this script merely FREEZES that current value onto each old order so
 * it stays stable if the dealer is re-mapped later.
 *
 * Source of truth for each order's dealer (mirrors getOrderDetails):
 *   dealer = order.dealerId, else order.createdBy when that user is a Dealer.
 *   routeName            <- dealer.routeName
 *   salesExecutiveMobile <- dealer.salesExecutive
 *
 * IMPORTANT: run `node scripts/update-dealer-salesexec.js` FIRST so dealers have
 * `routeName` populated; otherwise this backfill has nothing to copy.
 *
 * NOTE: this freezes the dealer's CURRENT mapping, not the true point-in-time
 * route (no per-order history exists for legacy orders). It does NOT touch
 * `focusRefs` — those IDs were only inputs to a past Focus post and have no
 * display use; they cannot be reconstructed historically.
 *
 * Usage:
 *   node mongoscripts/backfill_order_route_snapshot.js
 *
 * Reads MONGO_URI (or MONGODB_URI) from the environment (or .env via dotenv).
 *
 * Idempotent: only fills a field when it is currently empty, so it never
 * overwrites a Focus-sourced routeName and re-running is a no-op.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI (or MONGODB_URI) must be set in the environment.');
    process.exit(1);
}

const orderModel = require('../models/Order');
const userModel = require('../models/User');

// "Empty" = absent, null, or empty string.
const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Orders that are missing at least one of the two snapshot fields.
const NEEDS_BACKFILL = {
    $or: [
        { routeName: { $exists: false } },
        { routeName: { $in: [null, ''] } },
        { salesExecutiveMobile: { $exists: false } },
        { salesExecutiveMobile: { $in: [null, ''] } },
    ],
};

async function main() {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const candidates = await orderModel
        .find(NEEDS_BACKFILL, { _id: 1, orderId: 1, routeName: 1, salesExecutiveMobile: 1, dealerId: 1, createdBy: 1 })
        .lean();

    console.log(`Orders missing route/salesman snapshot: ${candidates.length}`);
    if (candidates.length === 0) {
        console.log('--- Nothing to backfill ---');
        await mongoose.disconnect();
        process.exit(0);
    }

    // Load every referenced user (dealerId + createdBy) in one round trip.
    const userIds = new Set();
    for (const o of candidates) {
        if (o.dealerId) userIds.add(o.dealerId.toString());
        if (o.createdBy) userIds.add(o.createdBy.toString());
    }
    const users = await userModel
        .find({ _id: { $in: [...userIds] } }, { _id: 1, accountType: 1, routeName: 1, salesExecutive: 1 })
        .lean();
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    let updated = 0;
    let filledRouteName = 0;
    let filledSalesExecMobile = 0;
    let skippedNoDealer = 0;        // could not resolve a Dealer for the order
    let skippedDealerNoData = 0;    // dealer found but has neither routeName nor salesExecutive
    let alreadyComplete = 0;        // both present (or nothing left to add)

    const bulkOps = [];

    for (const order of candidates) {
        // Resolve the dealer the same way getOrderDetails does.
        const byDealerId = order.dealerId ? userById.get(order.dealerId.toString()) : null;
        const byCreatedBy = order.createdBy ? userById.get(order.createdBy.toString()) : null;
        const dealer = byDealerId ?? (byCreatedBy && byCreatedBy.accountType === 'Dealer' ? byCreatedBy : null);

        if (!dealer) {
            skippedNoDealer++;
            continue;
        }

        const updates = {};
        if (isEmpty(order.routeName) && !isEmpty(dealer.routeName)) {
            updates.routeName = dealer.routeName;
            filledRouteName++;
        }
        if (isEmpty(order.salesExecutiveMobile) && !isEmpty(dealer.salesExecutive)) {
            updates.salesExecutiveMobile = dealer.salesExecutive;
            filledSalesExecMobile++;
        }

        if (Object.keys(updates).length === 0) {
            // Either the dealer has no usable data, or the order's gaps can't be filled.
            if (isEmpty(dealer.routeName) && isEmpty(dealer.salesExecutive)) {
                skippedDealerNoData++;
            } else {
                alreadyComplete++;
            }
            continue;
        }

        bulkOps.push({ updateOne: { filter: { _id: order._id }, update: { $set: updates } } });
        updated++;
    }

    if (bulkOps.length > 0) {
        console.log(`Applying ${bulkOps.length} updates...`);
        const BATCH_SIZE = 500;
        let modified = 0;
        for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
            const batch = bulkOps.slice(i, i + BATCH_SIZE);
            const result = await orderModel.bulkWrite(batch);
            modified += result.modifiedCount;
        }
        console.log(`Successfully modified ${modified} orders.`);
    }

    console.log('\n--- Backfill Summary ---');
    console.log(`Orders processed            : ${candidates.length}`);
    console.log(`Orders updated              : ${updated}`);
    console.log(`  - routeName filled        : ${filledRouteName}`);
    console.log(`  - salesExecutiveMobile    : ${filledSalesExecMobile}`);
    console.log(`Skipped (no dealer found)   : ${skippedNoDealer}`);
    console.log(`Skipped (dealer no route)   : ${skippedDealerNoData}`);
    console.log(`Skipped (nothing to add)    : ${alreadyComplete}\n`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('Critical error during backfill:', err);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});
