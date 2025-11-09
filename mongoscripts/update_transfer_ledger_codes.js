db = db.getSiblingDB('aultra-paints');

print(" Starting Dealer → SuperUser ledger unique code update...");

const transferNarrations = [
  "Transferred reward points to Super User",
  "Received reward points from dealer"
];

// Fetch all relevant ledgers sorted by createdAt (chronological)
const ledgers = db.transactionLedger
  .find({ narration: { $in: transferNarrations } })
  .sort({ createdAt: 1 })
  .toArray();

print(` Found ${ledgers.length} relevant ledger records.`);

const dailyCounters = {}; 
let updatedCount = 0;
const groups = [];

// 1️ Group both ledgers (Dealer + SuperUser) belonging to the same transaction
ledgers.forEach(ledger => {
  let user = null;
  try {
    user = db.users.findOne({ _id: ObjectId(ledger.userId) });
  } catch (e) {
    user = db.users.findOne({ _id: ledger.userId });
  }

  if (!user) return;

  let dealerCode = "";

  if (user.accountType === "Dealer" && user.dealerCode) {
    dealerCode = user.dealerCode.trim();
  } else if (user.accountType === "SuperUser") {
    // Find matching dealer transaction within 3 seconds
    const partnerLedger = db.transactionLedger.findOne({
      narration: "Transferred reward points to Super User",
      createdAt: {
        $gte: new Date(new Date(ledger.createdAt).getTime() - 3000),
        $lte: new Date(new Date(ledger.createdAt).getTime() + 3000)
      }
    });

    if (partnerLedger) {
      try {
        const dealerUser = db.users.findOne({ _id: ObjectId(partnerLedger.userId) });
        if (dealerUser && dealerUser.dealerCode) {
          dealerCode = dealerUser.dealerCode.trim();
        }
      } catch (e) {
        const dealerUser = db.users.findOne({ _id: partnerLedger.userId });
        if (dealerUser && dealerUser.dealerCode) {
          dealerCode = dealerUser.dealerCode.trim();
        }
      }
    }
  }

  if (!dealerCode) return;

  const absAmt = Math.abs(parseFloat(String(ledger.amount).replace(/[^\d.-]/g, "")));

  // Find existing transaction group 
  const existingGroup = groups.find(
    g =>
      g.dealerCode === dealerCode &&
      Math.abs(new Date(g.createdAt) - new Date(ledger.createdAt)) < 3000 &&
      g.absAmount === absAmt
  );

  if (existingGroup) {
    existingGroup.ledgers.push(ledger);
  } else {
    groups.push({
      dealerCode,
      createdAt: ledger.createdAt,
      absAmount: absAmt,
      ledgers: [ledger],
    });
  }
});

//  Sort all transaction groups by date/time 
groups.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

print(` Grouped ${groups.length} Dealer → SuperUser transactions.`);

// Assign global daily sequence number (same for all dealers)
groups.forEach(group => {
  const created = new Date(group.createdAt);
  const mm = String(created.getMonth() + 1).padStart(2, "0");
  const dd = String(created.getDate()).padStart(2, "0");
  const yy = String(created.getFullYear()).slice(-2);
  const datePart = `${mm}${dd}${yy}`;

  // Global per-day counter
  if (!dailyCounters[datePart]) dailyCounters[datePart] = 1;
  else dailyCounters[datePart]++;

  const seq = dailyCounters[datePart];
  const uniqueCode = `${group.dealerCode}_${datePart}_${seq}`;

  // Update both ledgers in this transaction
  group.ledgers.forEach(l => {
    db.transactionLedger.updateOne(
      { _id: l._id },
      { $set: { uniqueCode: uniqueCode } }
    );
    updatedCount++;
  });

  print(` Dealer ${group.dealerCode} | ${datePart} | Seq ${seq} | ${group.ledgers.length} ledgers updated`);
});

print(`Update complete. Total updated ledger documents: ${updatedCount}`);
