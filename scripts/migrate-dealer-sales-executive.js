/**
 * Migration Script: Update salesExecutive mobile on Dealer users from Excel
 *
 * The Excel file "Dealers list as on 16-02-2026.xlsx" maps each dealer code to a
 * Sales Executive Name. This script:
 *   1. Reads the Excel and builds a map of dealerCode → salesExecutiveName
 *   2. Looks up each unique Sales Executive by name (case-insensitive) in MongoDB
 *      and resolves their mobile number
 *   3. Updates each matching Dealer document's `salesExecutive` field with the SE's mobile
 *
 * Usage:
 *   node scripts/migrate-dealer-sales-executive.js
 *
 * Dry-run (preview only, no writes):
 *   DRY_RUN=true node scripts/migrate-dealer-sales-executive.js
 */

const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
require('dotenv').config();

const User = require('../models/User');

// ─── Config ──────────────────────────────────────────────────────────────────
const EXCEL_FILE = path.join(__dirname, '..', 'Dealers list as on 16-02-2026.xlsx');
const DRY_RUN = process.env.DRY_RUN === 'true';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalise a name for lookup: trim + collapse whitespace + upper-case */
function normaliseName(name) {
    if (!name) return '';
    return name.toString().trim().replace(/\s+/g, ' ').toUpperCase();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function migrate() {
    // 1. Connect — uses the same DB_HOST/DB_PORT/DB_NAME env vars as the app
    const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS } = process.env;
    if (!DB_HOST || !DB_PORT || !DB_NAME) {
        throw new Error('Missing required env vars: DB_HOST, DB_PORT, DB_NAME');
    }
    const mongoUrl = (DB_USER && DB_PASS)
        ? `mongodb://${DB_USER}:${DB_PASS}@${DB_HOST}/${DB_NAME}`
        : `mongodb://${DB_HOST}:${DB_PORT}/${DB_NAME}`;

    await mongoose.connect(mongoUrl);
    console.log(`✅  Connected to MongoDB → ${mongoUrl}`);

    if (DRY_RUN) {
        console.log('⚠️   DRY RUN mode – no documents will be written\n');
    }

    // 2. Parse Excel
    const wb = XLSX.readFile(EXCEL_FILE);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);  // [{S. No., Code, Name, Sales Executive Name}, ...]

    // Filter out blank rows
    const validRows = rows.filter(r => r['Code'] && r['Sales Executive Name']);
    console.log(`📄  Excel rows loaded: ${validRows.length}`);

    // 3. Collect unique SE names from the sheet
    const uniqueSENames = [...new Set(validRows.map(r => normaliseName(r['Sales Executive Name'])))];
    console.log(`👤  Unique Sales Executive names in Excel: ${uniqueSENames.length}`);

    // 4. Resolve each SE name → mobile
    //    Fetch ALL SalesExecutive users once, then compare normalised names in JS
    //    so that trailing/leading spaces in either the DB or Excel are irrelevant.
    const allSEUsers = await User.find({ accountType: 'SalesExecutive' }, { name: 1, mobile: 1 });
    console.log(`🔍  SalesExecutive accounts found in DB: ${allSEUsers.length}`);

    // Build a lookup map: normalisedDBName → mobile
    const dbNameToMobile = {};
    for (const seUser of allSEUsers) {
        const normDB = normaliseName(seUser.name);
        dbNameToMobile[normDB] = seUser.mobile;
    }

    const seNameToMobile = {};
    const missingInDB = [];

    for (const seName of uniqueSENames) {
        // seName is already normalised (from normaliseName in step 3)
        if (dbNameToMobile[seName] !== undefined) {
            seNameToMobile[seName] = dbNameToMobile[seName];
        } else {
            missingInDB.push(seName);
            seNameToMobile[seName] = null;
        }
    }

    if (missingInDB.length) {
        console.warn(`\n⚠️   ${missingInDB.length} Sales Executive(s) NOT found in DB (will be skipped):`);
        missingInDB.forEach(n => console.warn(`    - "${n}"`));
        console.log('');
    }

    // 5. Pre-load all Dealer users into a map: normalisedName → document
    //    Normalise both the DB name and the Excel Name column (trim + uppercase)
    //    so any leading/trailing spaces in either source don't cause false misses.
    const allDealers = await User.find({ accountType: 'Dealer' }, { name: 1, dealerCode: 1, salesExecutive: 1 });
    console.log(`🏪  Dealer accounts found in DB: ${allDealers.length}`);

    const dealerNameMap = {}; // normalisedName → dealer document
    for (const d of allDealers) {
        if (d.name) {
            dealerNameMap[normaliseName(d.name)] = d;
        }
    }

    // 6. Update dealers
    let updated = 0;
    let skippedNoSE = 0;
    let skippedNoDealerCode = 0;
    let unchanged = 0;
    let errors = 0;
    const missingDealers = []; // { code, excelName } for dealers not found in DB

    console.log('\n🔄  Processing dealers …\n');

    for (const row of validRows) {
        const dealerCode = row['Code'].toString().trim();
        const seName = normaliseName(row['Sales Executive Name']);
        const seMobile = seNameToMobile[seName];

        if (!seMobile) {
            skippedNoSE++;
            console.log(`  ⏭  SKIP  [${dealerCode}] – SE "${seName}" not found in DB`);
            continue;
        }

        // Look up the dealer using the normalised name from the Excel
        const excelDealerName = normaliseName(row['Name'] || '');
        const dealer = dealerNameMap[excelDealerName];

        if (!dealer) {
            skippedNoDealerCode++;
            missingDealers.push({ code: dealerCode, excelName: row['Name'] || '' });
            continue;
        }

        // Already up to date?
        if (dealer.salesExecutive === seMobile) {
            unchanged++;
            console.log(`  ✔  SAME  [${dealerCode}] "${dealer.name}" → ${seMobile} (no change)`);
            continue;
        }

        // Perform update
        const previousMobile = dealer.salesExecutive || '(none)';
        if (!DRY_RUN) {
            try {
                await User.updateOne(
                    { _id: dealer._id },
                    { $set: { salesExecutive: seMobile } }
                );
                updated++;
                console.log(`  ✅  OK    [${dealerCode}] "${dealer.name}" → SE mobile: ${previousMobile} ➜ ${seMobile}  (${seName})`);
            } catch (err) {
                errors++;
                console.error(`  ❌  ERR   [${dealerCode}] "${dealer.name}" – ${err.message}`);
            }
        } else {
            updated++;
            console.log(`  📝  WOULD [${dealerCode}] "${dealer.name}" → SE mobile: ${previousMobile} ➜ ${seMobile}  (${seName})`);
        }
    }

    // 6. Summary
    console.log('\n──────────────────────────────────────────');
    console.log('📊  Migration Summary');
    console.log('──────────────────────────────────────────');
    console.log(`  Total Excel rows processed : ${validRows.length}`);
    console.log(`  Updated                    : ${updated}`);
    console.log(`  Already up-to-date         : ${unchanged}`);
    console.log(`  Skipped (SE not in DB)     : ${skippedNoSE}`);
    console.log(`  Skipped (Dealer not in DB) : ${skippedNoDealerCode}`);
    console.log(`  Errors                     : ${errors}`);
    if (DRY_RUN) console.log('\n  ⚠️  DRY RUN – no data was modified');
    console.log('──────────────────────────────────────────');

    if (missingDealers.length) {
        console.log(`\n⚠️   Dealers in Excel NOT found in DB (${missingDealers.length}):`);
        console.log('─────────────────────────────────────────────────────────────────');
        missingDealers.forEach(({ code, excelName }) =>
            console.log(`  [${code}]  ${excelName}`)
        );
        console.log('─────────────────────────────────────────────────────────────────');
    }
    console.log('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────
migrate()
    .then(() => {
        console.log('🏁  Done');
        process.exit(0);
    })
    .catch((err) => {
        console.error('💥  Migration failed:', err);
        process.exit(1);
    })
    .finally(() => {
        mongoose.connection.close();
    });
