const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const BatchNumber = require('../models/batchnumber');
const Product = require('../models/Product');
const logger = require('../utils/logger');
const Brand = require('../models/Brand');

exports.getBatchStatistics = async (req, res) => {
    try {
        // Get all batch numbers
        const batches = await BatchNumber.find().select('ProductName _id Brand');
        
        // Get an array of batch IDs and brand IDs
        const batchIds = batches.map(batch => batch._id);
        const productIds = batches.map(batch => batch.ProductName);
        const brandIds = batches.map(batch => batch.Brand);

        console.log('Batches:', batches);
        console.log('Batch IDs:', batchIds);
        console.log('Product IDs:', productIds);
        console.log('Brand IDs:', brandIds);

        // Get product names for all product IDs
        const products = await Product.find({ _id: { $in: productIds } }).select('name');
        const productMap = new Map(products.map(product => [product._id.toString(), product.name]));

        // Get brand names for all brand IDs
        const brands = await Brand.find({ _id: { $in: brandIds } }).select('brands');
        const brandMap = new Map(brands.map(brand => [brand._id.toString(), brand.brands]));

        console.log('Product Map:', Array.from(productMap));
        console.log('Brand Map:', Array.from(brandMap));
        
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
            { $unwind: '$batchData' },
            {
                $project: {
                    batchNumber: { $ifNull: ['$batchData.BatchNumber', 'Unknown'] },
                    productName: { $ifNull: ['$batchData.ProductName', 'Unknown'] },
                    brandId: '$batchData.Brand',
                    branch: { $ifNull: ['$batchData.Branch', 'Unknown'] },        
                    quantity: 1,
                    redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', 0] },
                    value: { $ifNull: ['$batchData.value', 0] },
                    issuedPoints: { $multiply: ['$quantity', { $ifNull: ['$batchData.RedeemablePoints', 0] }] },
                    issuedValue: { $multiply: ['$quantity', { $ifNull: ['$batchData.value', 0] }] },
                    redeemedPoints: { $multiply: ['$pointsRedeemed', { $ifNull: ['$batchData.RedeemablePoints', 0] }] },
                    redeemedValue: { $multiply: ['$cashRedeemed', { $ifNull: ['$batchData.value', 0] }] }
                }
            },
            {
                $sort: {
                    "createdAt": -1
                }
            }
        ];

        console.log('Aggregation Pipeline:', JSON.stringify(pipeline, null, 2));

        const statistics = await Transaction.aggregate(pipeline);

        console.log('Raw Statistics:', JSON.stringify(statistics, null, 2));
        
        // Format data for bar chart
        const barChartData = {
            products: statistics.map(stat => {
                const productName = productMap.get(stat.productName.toString()) || 'Unknown';
                const brandName = brandMap.get(stat.brandId.toString()) || 'Unknown';
                console.log('Processing stat:', JSON.stringify({...stat, productName, brandName}, null, 2));
                return {
                    name: `${productName}-${brandName}-${stat.branch || 'Unknown'}`,
                    id: stat._id.toString()
                };
            }),
            metrics: [
                {
                    name: 'Issued Points',
                    data: statistics.map(stat => stat.issuedPoints || 0)
                },
                {
                    name: 'Issued Cash',
                    data: statistics.map(stat => stat.issuedValue || 0)
                },
                {
                    name: 'Redeemed Points',
                    data: statistics.map(stat => stat.redeemedPoints || 0)
                },
                {
                    name: 'Redeemed Cash',
                    data: statistics.map(stat => stat.redeemedValue || 0)
                }
            ]
        };

        console.log('Bar Chart Data:', JSON.stringify(barChartData, null, 2));

        return res.status(200).json(barChartData);
    } catch (error) {
        console.error('Error getting batch statistics:', error);
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
                        month: { $dateToString: { format: "%Y-%m", date: "$updatedAt", timezone: "Asia/Kolkata" } },
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
