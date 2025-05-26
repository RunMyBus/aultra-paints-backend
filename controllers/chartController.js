const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const BatchNumber = require('../models/batchnumber');
const Product = require('../models/Product');
const logger = require('../utils/logger');
const Brand = require('../models/Brand');

const { Parser } = require('json2csv');

exports.getBatchStatistics = async (req, res) => {
    try {
        // Get all batch numbers
        const batches = await BatchNumber.find().select('ProductName _id Brand');
        
        // Get an array of batch IDs and brand IDs
        const batchIds = batches.map(batch => batch._id);
        const productIds = batches.map(batch => batch.ProductName);
        const brandIds = batches.map(batch => batch.Brand);

        // Get product names for all product IDs
        const products = await Product.find({ _id: { $in: productIds } }).select('name');
        const productMap = new Map(products.map(product => [product._id.toString(), product.name]));

        // Get brand names for all brand IDs
        const brands = await Brand.find({ _id: { $in: brandIds } }).select('brands');
        const brandMap = new Map(brands.map(brand => [brand._id.toString(), brand.brands]));
        
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
                    createdAt: { $ifNull: ['$batchData.createdAt', new Date()] },
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

        const statistics = await Transaction.aggregate(pipeline);
        
        // Format data for bar chart
        const barChartData = {
            products: statistics.map(stat => {
                const productName = productMap.get(stat.productName.toString()) || 'Unknown';
                const brandName = brandMap.get(stat.brandId.toString()) || 'Unknown';
                const batchNumber = stat.batchNumber.toString() || 'Unknown';
                return {
                    name: `${productName}-${brandName}-${stat.branch}-${batchNumber}`,
                    id: stat._id.toString(),
                    createdAt: Math.floor(stat.createdAt.getTime() / 1000)
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

        return res.status(200).json(barChartData);
    } catch (error) {
        console.error('Error getting batch statistics:', error);
        return res.status(500).json({ error: error.message });
    }
};

exports.getBatchStatisticsList = async (req, res) => {
    try {
        const { page, limit, branches } = req.body;
        const skip = (page - 1) * limit;

        // Get all batch numbers
        const batches = await BatchNumber.find().select('ProductName _id Brand');

        // Get an array of batch IDs and brand IDs
        const batchIds = batches.map(batch => batch._id);
        const productIds = batches.map(batch => batch.ProductName);
        const brandIds = batches.map(batch => batch.Brand);

        // Get product names for all product IDs
        const products = await Product.find({ _id: { $in: productIds } }).select('name');
        const productMap = new Map(products.map(product => [product._id.toString(), product.name]));

        // Get brand names for all brand IDs
        const brands = await Brand.find({ _id: { $in: brandIds } }).select('brands');
        const brandMap = new Map(brands.map(brand => [brand._id.toString(), brand.brands]));

        // Pipeline to get distinct branches (without any filters)
        const branchPipeline = [
            {
                $match: {
                    batchId: { $in: batchIds }
                }
            },
            {
                $lookup: {
                    from: 'batchnumbers',
                    localField: 'batchId',
                    foreignField: '_id',
                    as: 'batchData'
                }
            },
            { $unwind: '$batchData' },
            {
                $group: {
                    _id: '$batchData.Branch'
                }
            },
            {
                $match: {
                    _id: { $ne: null }
                }
            },
            {
                $project: {
                    _id: 0,
                    branch: '$_id'
                }
            }
        ];

        // Base pipeline with batch filtering
        const basePipeline = [
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
            { $unwind: '$batchData' }
        ];

        // Add branch filter if provided
        if (branches.length > 0) {
            basePipeline.push({
                $match: {
                    "batchData.Branch": { $in: branches }
                }
            });
        }

        // Pipeline for counting total documents
        const countPipeline = [...basePipeline, { $count: 'total' }];

        // Pipeline for fetching data with pagination
        const dataPipeline = [
            ...basePipeline,
            {
                $project: {
                    batchNumber: { $ifNull: ['$batchData.BatchNumber', 'Unknown'] },
                    productName: { $ifNull: ['$batchData.ProductName', 'Unknown'] },
                    brandId: '$batchData.Brand',
                    branch: { $ifNull: ['$batchData.Branch', 'Unknown'] },
                    quantity: 1,
                    createdAt: { $ifNull: ['$batchData.createdAt', new Date()] },
                    redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', 0] },
                    value: { $ifNull: ['$batchData.value', 0] },
                    issuedPoints: {
                        $multiply: ['$quantity', { $ifNull: ['$batchData.RedeemablePoints', 0] }]
                    },
                    issuedValue: {
                        $multiply: ['$quantity', { $ifNull: ['$batchData.value', 0] }]
                    },
                    redeemedPoints: {
                        $multiply: ['$pointsRedeemed', { $ifNull: ['$batchData.RedeemablePoints', 0] }]
                    },
                    redeemedValue: {
                        $multiply: ['$cashRedeemed', { $ifNull: ['$batchData.value', 0] }]
                    }
                }
            },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: parseInt(limit) }
        ];

        // Execute both pipelines
        const [countResult, results, distinctBranches] = await Promise.all([
            Transaction.aggregate(countPipeline),
            Transaction.aggregate(dataPipeline),
            Transaction.aggregate(branchPipeline)
        ]);

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Transform into list format with product and brand names
        const listData = results.map(item => ({
            name: `${productMap.get(item.productName.toString()) || 'Unknown'}-${brandMap.get(item.brandId.toString()) || 'Unknown'}-${item.branch}-${item.batchNumber.toString() || 'Unknown'}`,
            branch: item.branch,
            createdAt: new Date(item.createdAt).toISOString(),
            issuedPoints: item.issuedPoints || 0,
            issuedCash: item.issuedValue || 0,
            redeemedPoints: item.redeemedPoints || 0,
            redeemedCash: item.redeemedValue || 0
        }));

        // Extract branches array from the distinctBranches result
        const allBranches = distinctBranches.map(b => b.branch).sort();

        return res.status(200).json({
            success: true,
            data: listData,
            branches: allBranches,
            pagination: {
                total,
                page: parseInt(page),
                totalPages,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getBatchStatisticsList', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// Modify the export function to use the list format
exports.exportBatchStatistics = async (req, res) => {
    try {
        const { branches = [] } = req.body;

        // Get all batch numbers
        const batches = await BatchNumber.find().select('ProductName _id Brand');

        // Get an array of batch IDs and create maps
        const batchIds = batches.map(batch => batch._id);
        const productIds = batches.map(batch => batch.ProductName);
        const brandIds = batches.map(batch => batch.Brand);

        // Get product and brand mappings
        const [products, brands] = await Promise.all([
            Product.find({ _id: { $in: productIds } }).select('name'),
            Brand.find({ _id: { $in: brandIds } }).select('brands')
        ]);

        const productMap = new Map(products.map(product => [product._id.toString(), product.name]));
        const brandMap = new Map(brands.map(brand => [brand._id.toString(), brand.brands]));

        // Base pipeline with batch filtering
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
            { $unwind: '$batchData' }
        ];

        // Add branch filter if provided
        if (branches.length > 0) {
            pipeline.push({
                $match: {
                    "batchData.Branch": { $in: branches }
                }
            });
        }

        // Add projection and sorting
        pipeline.push(
            {
                $project: {
                    batchNumber: { $ifNull: ['$batchData.BatchNumber', 'Unknown'] },
                    productName: { $ifNull: ['$batchData.ProductName', 'Unknown'] },
                    brandId: '$batchData.Brand',
                    branch: { $ifNull: ['$batchData.Branch', 'Unknown'] },
                    quantity: 1,
                    createdAt: { $ifNull: ['$batchData.createdAt', new Date()] },
                    redeemablePoints: { $ifNull: ['$batchData.RedeemablePoints', 0] },
                    value: { $ifNull: ['$batchData.value', 0] },
                    issuedPoints: {
                        $multiply: ['$quantity', { $ifNull: ['$batchData.RedeemablePoints', 0] }]
                    },
                    issuedValue: {
                        $multiply: ['$quantity', { $ifNull: ['$batchData.value', 0] }]
                    },
                    redeemedPoints: {
                        $multiply: ['$pointsRedeemed', { $ifNull: ['$batchData.RedeemablePoints', 0] }]
                    },
                    redeemedValue: {
                        $multiply: ['$cashRedeemed', { $ifNull: ['$batchData.value', 0] }]
                    }
                }
            },
            { $sort: { createdAt: -1 } }
        );

        // Execute pipeline
        const results = await Transaction.aggregate(pipeline);

        // Transform data for export
        const exportData = results.map(item => ({
            'Name': `${productMap.get(item.productName.toString()) || 'Unknown'}-${brandMap.get(item.brandId.toString()) || 'Unknown'}-${item.branch}-${item.batchNumber}`,
            'Created Date': new Date(item.createdAt).toISOString(),
            'Issued Points': item.issuedPoints || 0,
            'Issued Cash': item.issuedValue || 0,
            'Redeemed Points': item.redeemedPoints || 0,
            'Redeemed Cash': item.redeemedValue || 0
        }));

        const fields = [
            'Name',
            'Created Date',
            'Issued Points',
            'Issued Cash',
            'Redeemed Points',
            'Redeemed Cash'
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(exportData);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=Coupon-Statistics.csv');
        return res.send(csv);

    } catch (error) {
        console.error('Error in exportBatchStatistics:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
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
