const { MongoClient, ObjectId } = require("mongodb");

async function run() {
    const uri = "mongodb://localhost:27017";
    const dbName = "aultrapaints";

    const superUserId = "6790567fc30a4b68af4d58e4";

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);

        console.log("Fetching dealer → super user transfers...");

        // 1. Fetch all RECEIVED transfers for this SuperUser (excluding reversals)
        const received = await db.collection("transactionLedger").aggregate([
            {
                $match: {
                    userId: superUserId,
                    narration: "Received reward points from dealer",
                    uniqueCode: { $not: /_REVERSAL$/ },
                    amount: { $regex: /^\+\s*\d+/ }
                }
            },
            {
                $addFields: {
                    amountValue: {
                        $toInt: {
                            $trim: {
                                input: { $replaceAll: { input: "$amount", find: "+", replacement: "" } }
                            }
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: "transactionLedger",
                    let: { uc: "$uniqueCode" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$uniqueCode", "$$uc"] },
                                        { $eq: ["$narration", "Transferred reward points to Super User"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "dealerEntry"
                }
            },
            { $unwind: "$dealerEntry" },
            {
                $addFields: {
                    dealerUserIdObj: { $toObjectId: "$dealerEntry.userId" }
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "dealerUserIdObj",
                    foreignField: "_id",
                    as: "dealer"
                }
            },
            { $unwind: "$dealer" },
            {
                $group: {
                    _id: {
                        dealerId: "$dealer._id",
                        dealerName: "$dealer.name",
                        dealerMobile: "$dealer.mobile",
                        dealerCode: "$dealer.dealerCode"
                    },
                    totalTransferred: { $sum: "$amountValue" }
                }
            },
            {
                $project: {
                    _id: 0,
                    dealerId: "$_id.dealerId",
                    dealerName: "$_id.dealerName",
                    dealerMobile: "$_id.dealerMobile",
                    dealerCode: "$_id.dealerCode",
                    totalTransferred: 1
                }
            }
        ]).toArray();

        if (received.length === 0) {
            console.log("No dealer transfers found for reversal.");
            return;
        }

        console.log(`Found ${received.length} dealers with transferable points.`);

        // Fetch super user current balance
        const superUser = await db.collection("users").findOne({ _id: new ObjectId(superUserId) });

        let totalSuperUserDebitRequired = received.reduce((sum, r) => sum + r.totalTransferred, 0);

        if (superUser.rewardPoints < totalSuperUserDebitRequired) {
            console.log("ERROR: SuperUser does not have enough points to reverse all transfers.");
            return;
        }

        // REVERSE for each dealer
        for (const r of received) {
            const dealerId = r.dealerId;
            const dealerCode = r.dealerCode || '';
            const dealerName = r.dealerName || r.dealerId || '';
            const total = r.totalTransferred;

            const reversalCode = `${dealerCode}_REVERSAL`;

            console.log(`Reversing ${total} points for dealer ${dealerName} (${dealerCode})`);

            // skip if already reversed
            const exists = await db.collection("transactionLedger").findOne({
                uniqueCode: reversalCode
            });
            if (exists) {
                console.log(` → Skipped (Already reversed earlier)`);
                continue;
            }

            // Update dealer reward points
            await db.collection("users").updateOne(
                { _id: dealerId },
                { $inc: { rewardPoints: total } }
            );

            // Fetch updated dealer balance
            const updatedDealer = await db.collection("users").findOne(
                { _id: dealerId },
                { projection: { rewardPoints: 1 } }
            );

            // Update super user reward points
            await db.collection("users").updateOne(
                { _id: new ObjectId(superUserId) },
                { $inc: { rewardPoints: -total } }
            );

            // Fetch updated super user balance
            const updatedSuper = await db.collection("users").findOne(
                { _id: new ObjectId(superUserId) },
                { projection: { rewardPoints: 1 } }
            );

            // Dealer ledger record — ONE per dealer
            await db.collection("transactionLedger").insertOne({
                userId: dealerId.toString(),
                narration: "Reversal: Received reward points from Super User",
                amount: `+ ${total}`,
                balance: updatedDealer.rewardPoints,
                uniqueCode: reversalCode,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            // Super user ledger record — ONE per dealer
            await db.collection("transactionLedger").insertOne({
                userId: superUserId,
                narration: `Reversal: Returned reward points to dealer ${dealerCode}`,
                amount: `- ${total}`,
                balance: updatedSuper.rewardPoints,
                uniqueCode: reversalCode,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            console.log(` → Reversed`);
        }

        console.log("\nReversal completed successfully.");

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

run();
