const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const BatchNumber = require('../models/batchnumber');
const Product = require('../models/Product');
const logger = require('../utils/logger');

exports.getBatchStatistics = async (req, res) => {
    try {
        // Get all batch numbers
        const batches = await BatchNumber.find().select('ProductName _id');
        
        // Get an array of batch IDs
        const batchIds = batches.map(batch => batch._id);
        const productIds = batches.map(batch => batch.ProductName);

        console.log('batches --------- ', batches);
        console.log('batchIds --------- ', batchIds);
        console.log('productIds --------- ', productIds);

        // Get product names for all product IDs
        const products = await Product.find({ _id: { $in: productIds } }).select('name');
        const productMap = new Map();
        products.forEach(product => {
            productMap.set(product._id.toString(), product.name);
        });

        console.log('productMap --------- ', productMap);
        
        // Prepare aggregation pipeline for batch statistics
        const pipeline = [
            {
                $match: {
                    batchId: { $in: batchIds }
                }
            },
            {
                $group: {
                    _id: "$batchId",
                    quantity: { $sum: 1 },
                    pointsRedeemed: {
                        $sum: {
                            $cond: [{
                                $or: [
                                    {
                                        $and: [
                                            { $gt: [{ $type: "$pointsRedeemedBy" }, "missing"] },
                                            { $ne: ["$pointsRedeemedBy", null] },
                                            { $ne: ["$pointsRedeemedBy", ""] }
                                        ]
                                    }
                                ]
                            }, 1, 0]
                        }
                    },
                    cashRedeemed: {
                        $sum: {
                            $cond: [{
                                $or: [
                                    {
                                        $and: [
                                            { $gt: [{ $type: "$cashRedeemedBy" }, "missing"] },
                                            { $ne: ["$cashRedeemedBy", null] },
                                            { $ne: ["$cashRedeemedBy", ""] }
                                        ]
                                    }
                                ]
                            }, 1, 0]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'batchnumbers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'batchData'
                }
            },
            {
                $project: {
                    batchNumber: { $arrayElemAt: ["$batchData.BatchNumber", 0] },
                    productName: { $arrayElemAt: ["$batchData.ProductName", 0] },
                    quantity: 1,
                    redeemablePoints: { $arrayElemAt: ["$batchData.RedeemablePoints", 0] },
                    value: { $arrayElemAt: ["$batchData.value", 0] },
                    issuedPoints: { $multiply: ["$quantity", { $arrayElemAt: ["$batchData.RedeemablePoints", 0] }] },
                    issuedValue: { $multiply: ["$quantity", { $arrayElemAt: ["$batchData.value", 0] }] },
                    redeemedPoints: { $multiply: ["$pointsRedeemed", { $arrayElemAt: ["$batchData.RedeemablePoints", 0] }] },
                    redeemedValue: { $multiply: ["$cashRedeemed", { $arrayElemAt: ["$batchData.value", 0] }] }
                }
            },
            {
                $sort: {
                    "createdAt": -1
                }
            }
        ];

        console.log('pipeline --------- ', pipeline);

        const statistics = await Transaction.aggregate(pipeline);

        // console.log('statistics --------- ', statistics);
        
        // Format data for bar chart
        const barChartData = {
            products: statistics.map(stat => ({
                name: productMap.get(stat.productName.toString()),
                id: stat._id.toString()
            })),
            metrics: [
                {
                    name: 'Issued Points',
                    data: statistics.map(stat => stat.issuedPoints)
                },
                {
                    name: 'Issued Cash',
                    data: statistics.map(stat => stat.issuedValue)
                },
                {
                    name: 'Redeemed Points',
                    data: statistics.map(stat => stat.redeemedPoints)
                },
                {
                    name: 'Redeemed Cash',
                    data: statistics.map(stat => stat.redeemedValue)
                }
            ]
        };

        // console.log('barChartData --------- ', barChartData);

        return res.status(200).json(barChartData);
    } catch (error) {
        logger.error('Error getting batch statistics:', error);
        return res.status(500).json({ error: error.message });
    }
};

exports.getMonthlyBatchStatistics = async (req, res) => {
    try {
        const { batchId } = req.query;

        if (!batchId) {
            return res.status(400).json({ error: "Missing batchId" });
        }

        const objectId = new mongoose.Types.ObjectId(batchId);

        const pipeline = [
            {
                $match: { batchId: objectId }
            },
            {
                $lookup: {
                    from: 'batchnumbers',
                    localField: 'batchId',
                    foreignField: '_id',
                    as: 'batchData'
                }
            },
            {
                $unwind: '$batchData'
            },
            {
                $group: {
                    _id: {
                        month: { $dateToString: { format: "%B %Y", date: "$updatedAt" } },
                        batchId: "$batchId"
                    },
                    quantity: { $sum: 1 },
                    pointsRedeemedCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: [{ $type: "$pointsRedeemedBy" }, "missing"] },
                                        { $ne: ["$pointsRedeemedBy", null] },
                                        { $ne: ["$pointsRedeemedBy", ""] }
                                    ]
                                }, 1, 0
                            ]
                        }
                    },
                    cashRedeemedCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: [{ $type: "$cashRedeemedBy" }, "missing"] },
                                        { $ne: ["$cashRedeemedBy", null] },
                                        { $ne: ["$cashRedeemedBy", ""] }
                                    ]
                                }, 1, 0
                            ]
                        }
                    },
                    redeemablePoints: { $first: "$batchData.RedeemablePoints" },
                    value: { $first: "$batchData.value" }
                }
            },
            {
                $project: {
                    month: "$_id.month",
                    quantity: 1,
                    redeemedPoints: { $multiply: ["$pointsRedeemedCount", "$redeemablePoints"] },
                    redeemedValue: { $multiply: ["$cashRedeemedCount", "$value"] }
                }
            },
            {
                $sort: { month: 1 }
            }
        ];

        const batch = await BatchNumber.findById(objectId).select('Quantity RedeemablePoints value');

        const issuedPoints = batch.Quantity * batch.RedeemablePoints;
        const issuedValue = batch.Quantity * batch.value;
        

        const statistics = await Transaction.aggregate(pipeline);

        const chartData = {
            months: statistics.map(stat => stat.month),
            issuedPoints,
            issuedValue,
            metrics: [
                { name: 'Redeemed Points', data: statistics.map(stat => stat.redeemedPoints) },
                { name: 'Redeemed Cash', data: statistics.map(stat => stat.redeemedValue) }
            ]
        };

        return res.status(200).json(chartData);
    } catch (error) {
        logger.error('Error getting monthly batch statistics:', error);
        return res.status(500).json({ error: error.message });
    }
};
