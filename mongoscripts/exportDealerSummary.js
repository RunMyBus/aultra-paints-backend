const { MongoClient } = require("mongodb");
const fs = require("fs");

// run this command: node exportDealerSummary.js

async function run() {
    const uri = "mongodb://localhost:27017";
    const dbName = "aultrapaints";

    const superUserId = "6790567fc30a4b68af4d58e4";

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);

        const pipeline = [
            {
                $match: {
                    userId: superUserId,
                    narration: "Received reward points from dealer",
                    amount: { $regex: /^\+\s*\d+/ }
                }
            },
            {
                $addFields: {
                    amountValue: {
                        $toInt: {
                            $trim: {
                                input: {
                                    $replaceAll: {
                                        input: "$amount",
                                        find: "+",
                                        replacement: ""
                                    }
                                }
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
        ];

        const results = await db.collection("transactionLedger").aggregate(pipeline).toArray();

        function csvEscape(value) {
            if (value == null) return "";
            value = value.toString();
            // Escape double quotes by doubling them
            value = value.replace(/"/g, '""');
            // Wrap in quotes so commas/newlines/long text stay in one column
            return `"${value}"`;
        }

        // Build CSV
        let csv = "Dealer Id,Dealer Name,Dealer Mobile,Dealer Code,Total Transferred\n";
        results.forEach(r => {
            csv += [
                csvEscape(r.dealerId),
                csvEscape(r.dealerName),
                csvEscape(r.dealerMobile),
                csvEscape(r.dealerCode),
                r.totalTransferred // numeric values do NOT need quotes
            ].join(",") + "\n";
        });

        fs.writeFileSync("dealer_points_transfer_summary.csv", csv);
        console.log("CSV exported successfully: dealer_summary.csv");
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

run();
