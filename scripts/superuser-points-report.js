/**
 * superuser-points-report.js
 *
 * Generates an Excel report showing how super-user 9246573556
 * accumulated their current reward-point balance.
 *
 * Usage:
 *   DB_NAME=aultrapaints_prod_dump_04_06_2026 node scripts/superuser-points-report.js
 *
 * Or override via arg:
 *   node scripts/superuser-points-report.js aultrapaints_prod_dump_04_06_2026
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const path     = require('path');

// ─── Allow DB override via CLI arg ────────────────────────────────────────────
const dbOverride = process.argv[2];
if (dbOverride) process.env.DB_NAME = dbOverride;

require('../database/mongoose'); // uses env vars to connect

// ─── Models ───────────────────────────────────────────────────────────────────
const TransactionLedger = require('../models/TransactionLedger');
const User = require('../models/User');

// ─── Target user ──────────────────────────────────────────────────────────────
const SUPER_USER_MOBILE = '9246573556';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
    if (!d) return '';
    const dt   = new Date(d);
    const day  = String(dt.getDate()).padStart(2, '0');
    const mon  = String(dt.getMonth() + 1).padStart(2, '0');
    const year = dt.getFullYear();
    const h    = dt.getHours();
    const min  = String(dt.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${day}-${mon}-${year} ${hour}:${min} ${ampm}`;
}

/** Parse the numeric magnitude out of pointsCredited, which may look like
 *  "500", "+ 500", "- 500", "500.00", etc. */
function parsePoints(raw) {
    if (raw === undefined || raw === null) return 0;
    return parseFloat(String(raw).replace(/[^0-9.]/g, '')) || 0;
}

/** Classify a ledger row into one of three types. */
function classifyRow(narration = '') {
    if (narration.startsWith('Reversal')) return 'Reversal';
    if (narration.toLowerCase().includes('credit note')) return 'CN Deduction';
    return 'Received';
}

/** Extract dealer code from a uniqueCode or narration string.
 *
 *  - Received rows:    uniqueCode = "DEALERCODE_MMDDYY_N" → split on '_', first part
 *  - Reversal rows:    narration  = "Reversal: Returned reward points to dealer DEALERCODE"
 *  - CN rows:          uniqueCode = "CN_DEALERCODE_..." → middle segment(s)
 */
function extractDealerCode(row) {
    const type = classifyRow(row.narration);

    if (type === 'Received' && row.uniqueCode) {
        // uniqueCode format: DAPGTRMNG005_070225_1
        return row.uniqueCode.split('_')[0] || '';
    }

    if (type === 'Reversal') {
        // "Reversal: Returned reward points to dealer DAPGTRMNG005"
        const m = row.narration.match(/dealer\s+(\S+)$/i);
        return m ? m[1] : '';
    }

    if (type === 'CN Deduction' && row.uniqueCode) {
        // "CN_DEALERCODE_..." — strip leading "CN_" and trailing counter
        const parts = row.uniqueCode.split('_');
        // parts[0] === 'CN', parts[1..n-1] is the dealer code (may itself contain underscores)
        // Typical format: CN_DAPGTRMNG005_20250704_123456789
        if (parts[0] === 'CN' && parts.length >= 2) {
            return parts[1];
        }
        return '';
    }

    return '';
}

// ─── Style helpers ────────────────────────────────────────────────────────────
function headerStyle(ws, row, bgArgb = 'FF4472C4') {
    row.eachCell(cell => {
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.font   = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
}

function borderCell(cell) {
    cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    // Wait for Mongoose connection
    await new Promise((resolve, reject) => {
        mongoose.connection.once('open', resolve);
        mongoose.connection.once('error', reject);
    });

    console.log('✓ Connected to:', mongoose.connection.db.databaseName);

    // 1. Find the super user
    const superUser = await User.findOne({ mobile: SUPER_USER_MOBILE }).lean();
    if (!superUser) throw new Error(`User ${SUPER_USER_MOBILE} not found`);
    console.log(`✓ Super user: ${superUser.name} (${superUser._id}), balance: ${superUser.rewardPoints} pts`);

    // 2. Fetch all ledger rows for this user, oldest first
    const rows = await TransactionLedger
        .find({ userId: String(superUser._id) })
        .sort({ createdAt: 1 })
        .lean();
    console.log(`✓ ${rows.length} ledger rows found`);

    // 3. Collect all dealer codes and resolve names in bulk
    const dealerCodes = [...new Set(rows.map(extractDealerCode).filter(Boolean))];
    const dealers = await User.find(
        { dealerCode: { $in: dealerCodes }, accountType: 'Dealer' },
        'name dealerCode'
    ).lean();
    const dealerMap = {}; // dealerCode → name
    for (const d of dealers) dealerMap[d.dealerCode] = d.name;
    console.log(`✓ Resolved ${dealers.length}/${dealerCodes.length} dealer names`);

    // 4. Build enriched row data with running balance
    let runningBalance = 0;
    const enriched = rows.map(row => {
        const type        = classifyRow(row.narration);
        const magnitude   = parsePoints(row.pointsCredited);
        const pointChange = type === 'Received' ? +magnitude : -magnitude;
        runningBalance   += pointChange;

        const dealerCode = extractDealerCode(row);
        const dealerName = dealerMap[dealerCode] || '';

        return {
            date:           row.createdAt,
            type,
            dealerCode,
            dealerName,
            narration:      row.narration,
            pointChange,
            runningBalance,
            uniqueCode:     row.uniqueCode || '',
            rawPoints:      row.pointsCredited || '',
        };
    });

    // 5. Build summary by type
    const summaryMap = { Received: { count: 0, total: 0 }, Reversal: { count: 0, total: 0 }, 'CN Deduction': { count: 0, total: 0 } };
    for (const r of enriched) {
        summaryMap[r.type].count++;
        summaryMap[r.type].total += r.pointChange;
    }

    // 6. Build by-dealer breakdown
    const byDealerMap = {}; // dealerCode → { name, received, reversed, cnDeduction }
    for (const r of enriched) {
        const code = r.dealerCode || '(unknown)';
        if (!byDealerMap[code]) {
            byDealerMap[code] = { code, name: r.dealerName || dealerMap[code] || '', received: 0, reversed: 0, cnDeduction: 0 };
        }
        if (r.type === 'Received')      byDealerMap[code].received    += r.pointChange;
        if (r.type === 'Reversal')      byDealerMap[code].reversed    += Math.abs(r.pointChange);
        if (r.type === 'CN Deduction')  byDealerMap[code].cnDeduction += Math.abs(r.pointChange);
    }
    const byDealer = Object.values(byDealerMap).sort((a, b) => (b.received - b.reversed) - (a.received - a.reversed));

    // ── Build workbook ────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = 'AultraPaints Admin';
    wb.created  = new Date();

    // ── Sheet 1: Transaction History ─────────────────────────────────────────
    const ws1 = wb.addWorksheet('Transaction History', {
        views: [{ state: 'frozen', ySplit: 1 }],
        pageSetup: { fitToPage: true, fitToWidth: 1 },
    });

    ws1.columns = [
        { header: '#',               key: 'idx',            width: 6  },
        { header: 'Date',            key: 'date',           width: 22 },
        { header: 'Type',            key: 'type',           width: 18 },
        { header: 'Dealer Code',     key: 'dealerCode',     width: 18 },
        { header: 'Dealer Name',     key: 'dealerName',     width: 28 },
        { header: 'Narration',       key: 'narration',      width: 50 },
        { header: 'Points Change',   key: 'pointChange',    width: 16 },
        { header: 'Running Balance', key: 'runningBalance', width: 18 },
        { header: 'Unique Code',     key: 'uniqueCode',     width: 30 },
    ];

    // Style header row
    headerStyle(ws1, ws1.getRow(1));

    // Data rows
    const TYPE_COLORS = {
        'Received':     'FFE2EFDA', // light green
        'Reversal':     'FFFFF2CC', // light yellow
        'CN Deduction': 'FFFCE4D6', // light red-orange
    };

    enriched.forEach((r, i) => {
        const row = ws1.addRow({
            idx:            i + 1,
            date:           fmtDate(r.date),
            type:           r.type,
            dealerCode:     r.dealerCode,
            dealerName:     r.dealerName,
            narration:      r.narration,
            pointChange:    r.pointChange,
            runningBalance: r.runningBalance,
            uniqueCode:     r.uniqueCode,
        });

        const bg = TYPE_COLORS[r.type] || 'FFFFFFFF';
        row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            borderCell(cell);
            cell.alignment = { vertical: 'middle' };
        });

        // Colour the pointChange cell: green for positive, red for negative
        const ptCell = row.getCell('pointChange');
        ptCell.font = { bold: true, color: { argb: r.pointChange >= 0 ? 'FF375623' : 'FF9C0006' } };
        ptCell.alignment = { horizontal: 'right' };

        row.getCell('runningBalance').alignment = { horizontal: 'right' };
        row.getCell('idx').alignment            = { horizontal: 'center' };
    });

    // Auto-filter
    ws1.autoFilter = { from: 'A1', to: 'I1' };

    // ── Sheet 2: Summary ─────────────────────────────────────────────────────
    const ws2 = wb.addWorksheet('Summary');

    // User info block
    const infoRows = [
        ['Report generated', fmtDate(new Date())],
        ['User name',        superUser.name],
        ['Mobile',           SUPER_USER_MOBILE],
        ['Current balance',  superUser.rewardPoints],
        ['Computed balance', enriched.length ? enriched[enriched.length - 1].runningBalance : 0],
        ['Total rows',       rows.length],
    ];

    infoRows.forEach(([label, value]) => {
        const row = ws2.addRow([label, value]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        row.getCell(1).border = { right: { style: 'thin' } };
        borderCell(row.getCell(2));
    });

    ws2.addRow([]);

    // Summary table
    const sumHeader = ws2.addRow(['Type', 'Count', 'Total Points', '% of Credits']);
    headerStyle(ws2, sumHeader, 'FF4472C4');
    ws2.columns = [
        { key: 'a', width: 22 },
        { key: 'b', width: 12 },
        { key: 'c', width: 18 },
        { key: 'd', width: 16 },
    ];

    const totalCredits = summaryMap['Received'].total;
    const summaryRows = [
        ['Received',     summaryMap['Received'].count,     summaryMap['Received'].total,     '100%'],
        ['Reversal',     summaryMap['Reversal'].count,     summaryMap['Reversal'].total,     `${Math.abs(summaryMap['Reversal'].total / totalCredits * 100).toFixed(1)}%`],
        ['CN Deduction', summaryMap['CN Deduction'].count, summaryMap['CN Deduction'].total, `${Math.abs(summaryMap['CN Deduction'].total / totalCredits * 100).toFixed(1)}%`],
    ];

    const sumBgs = ['FFE2EFDA', 'FFFFF2CC', 'FFFCE4D6'];
    summaryRows.forEach(([type, count, total, pct], idx) => {
        const row = ws2.addRow([type, count, total, pct]);
        row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sumBgs[idx] } };
            borderCell(cell);
            cell.alignment = { vertical: 'middle' };
        });
        row.getCell(3).font = { bold: true, color: { argb: total >= 0 ? 'FF375623' : 'FF9C0006' } };
    });

    // Net balance row
    const netRow = ws2.addRow(['Net Balance', rows.length, enriched.length ? enriched[enriched.length - 1].runningBalance : 0, '']);
    netRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        borderCell(cell);
    });

    // ── Sheet 3: By Dealer ────────────────────────────────────────────────────
    const ws3 = wb.addWorksheet('By Dealer', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws3.columns = [
        { header: '#',              key: 'idx',          width: 6  },
        { header: 'Dealer Code',    key: 'code',         width: 18 },
        { header: 'Dealer Name',    key: 'name',         width: 30 },
        { header: 'Pts Received',   key: 'received',     width: 16 },
        { header: 'Pts Reversed',   key: 'reversed',     width: 16 },
        { header: 'CN Deductions',  key: 'cnDeduction',  width: 16 },
        { header: 'Net Pts to User',key: 'net',          width: 18 },
    ];

    headerStyle(ws3, ws3.getRow(1));

    byDealer.forEach((d, i) => {
        const net = d.received - d.reversed - d.cnDeduction;
        const row = ws3.addRow({
            idx:         i + 1,
            code:        d.code,
            name:        d.name,
            received:    d.received,
            reversed:    d.reversed,
            cnDeduction: d.cnDeduction,
            net,
        });
        const bg = i % 2 === 0 ? 'FFF2F2F2' : 'FFFFFFFF';
        row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            borderCell(cell);
            cell.alignment = { vertical: 'middle' };
        });
        row.getCell('net').font = { bold: true, color: { argb: net >= 0 ? 'FF375623' : 'FF9C0006' } };
        row.getCell('idx').alignment = { horizontal: 'center' };
    });

    ws3.autoFilter = { from: 'A1', to: 'G1' };

    // ── Save ──────────────────────────────────────────────────────────────────
    const outFile = path.join(
        __dirname,
        `SuperUser_${SUPER_USER_MOBILE}_PointsReport_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    await wb.xlsx.writeFile(outFile);
    console.log(`\n✅  Report saved to: ${outFile}`);
    console.log(`    Rows: ${enriched.length} | Final balance computed: ${enriched.length ? enriched[enriched.length - 1].runningBalance : 0} | DB balance: ${superUser.rewardPoints}`);

    mongoose.disconnect();
}

main().catch(err => {
    console.error('Error:', err);
    mongoose.disconnect();
    process.exit(1);
});
