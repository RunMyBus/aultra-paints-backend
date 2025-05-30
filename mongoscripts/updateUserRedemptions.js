// Switch to your DB
db = db.getSiblingDB('aultrapaints');

db.transactions.createIndex({ pointsRedeemedBy: 1 });
db.transactions.createIndex({ cashRedeemedBy: 1 });

// Fetch all users with their mobile numbers
const users = db.users.find({}, { mobile: 1 }).toArray();

// Array to collect redemption summaries
const redemptionSummary = [];

users.forEach(user => {
    const mobile = user.mobile;

    const result = db.transactions.aggregate([
        {
            $match: {
                $or: [
                    { pointsRedeemedBy: mobile },
                    { cashRedeemedBy: mobile }
                ]
            }
        },
        {
            $group: {
                _id: null,
                totalRedeemedPoints: {
                    $sum: {
                        $cond: [
                            { $eq: ["$pointsRedeemedBy", mobile] },
                            "$redeemablePoints",
                            0
                        ]
                    }
                },
                totalRedeemedCash: {
                    $sum: {
                        $cond: [
                            { $eq: ["$cashRedeemedBy", mobile] },
                            "$value",
                            0
                        ]
                    }
                }
            }
        },
        {
            $project: {
                _id: 0,
                totalRedeemedPoints: 1,
                totalRedeemedCash: 1
            }
        }
    ]).toArray();

    if (result.length > 0) {
        redemptionSummary.push({
            mobile: mobile,
            totalRedeemedPoints: result[0].totalRedeemedPoints,
            totalRedeemedCash: result[0].totalRedeemedCash
        });
    }
});

// Update users collection
redemptionSummary.forEach(user => {
    db.users.updateOne(
        { mobile: user.mobile },
        {
            $set: {
                rewardPoints: user.totalRedeemedPoints,
                cash: user.totalRedeemedCash
            }
        }
    );
});

print("✅ Users updated successfully based on redemption data.");
