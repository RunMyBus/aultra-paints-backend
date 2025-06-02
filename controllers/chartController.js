const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const BatchNumber = require('../models/batchnumber');
const Product = require('../models/Product');
const logger = require('../utils/logger');
const Brand = require('../models/Brand');

const { Parser } = require('json2csv');

exports.getBatchStatistics = async (req, res) => {
  try {
    // Fetch all batches with BrandStr and ProductStr computed similarly to your getAllBatchNumbers method
    const batches = await BatchNumber.aggregate([
      {
        $addFields: {
          BrandObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$Brand", null] },
                  { $ne: [{ $type: "$Brand" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$Brand" },
              else: "$Brand"
            }
          },
          ProductNameObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$ProductName", null] },
                  { $ne: [{ $type: "$ProductName" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$ProductName" },
              else: "$ProductName"
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "BrandObjId",
          foreignField: "_id",
          as: "productDataNew"
        }
      },
      {
        $lookup: {
          from: "brands",
          localField: "ProductNameObjId",
          foreignField: "_id",
          as: "brandDataNew"
        }
      },
      {
        $lookup: {
          from: "brands",
          localField: "BrandObjId",
          foreignField: "_id",
          as: "brandDataOld"
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "ProductNameObjId",
          foreignField: "_id",
          as: "productDataOld"
        }
      },
      {
        $project: {
          _id: 1,
          BatchNumber: 1,
          Branch: 1,
          createdAt: 1,
          BrandStr: {
            $cond: [
              { $gt: [{ $size: "$brandDataNew" }, 0] },
              { $arrayElemAt: ["$brandDataNew.name", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$brandDataOld" }, 0] },
                  { $arrayElemAt: ["$brandDataOld.name", 0] },
                  "$Brand"
                ]
              }
            ]
          },
          ProductStr: {
            $cond: [
              { $gt: [{ $size: "$productDataNew" }, 0] },
              { $arrayElemAt: ["$productDataNew.products", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$productDataOld" }, 0] },
                  { $arrayElemAt: ["$productDataOld.products", 0] },
                  "$ProductName"
                ]
              }
            ]
          }
        }
      }
    ]);

    const batchIds = batches.map(b => b._id);

    // Aggregate transactions by batchId to get stats
    const pipeline = [
      { $match: { batchId: { $in: batchIds } } },
      {
        $group: {
          _id: "$batchId",
          quantity: { $sum: 1 },
          pointsRedeemed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $type: "$pointsRedeemedBy" }, "missing"] },
                    { $ne: ["$pointsRedeemedBy", null] },
                    { $ne: ["$pointsRedeemedBy", ""] }
                  ]
                },
                1,
                0
              ]
            }
          },
          cashRedeemed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $type: "$cashRedeemedBy" }, "missing"] },
                    { $ne: ["$cashRedeemedBy", null] },
                    { $ne: ["$cashRedeemedBy", ""] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "batchnumbers",
          localField: "_id",
          foreignField: "_id",
          as: "batchData"
        }
      },
      { $unwind: "$batchData" },
      {
        $project: {
          _id: 1,
          batchNumber: { $ifNull: ["$batchData.BatchNumber", "Unknown"] },
          brandId: "$batchData.Brand",
          productNameId: "$batchData.ProductName",
          branch: { $ifNull: ["$batchData.Branch", "Unknown"] },
          quantity: 1,
          createdAt: { $ifNull: ["$batchData.createdAt", new Date()] },
          redeemablePoints: { $ifNull: ["$batchData.RedeemablePoints", 0] },
          value: { $ifNull: ["$batchData.value", 0] },
          pointsRedeemed: 1,
          cashRedeemed: 1,
          issuedPoints: { $multiply: ["$quantity", { $ifNull: ["$batchData.RedeemablePoints", 0] }] },
          issuedValue: { $multiply: ["$quantity", { $ifNull: ["$batchData.value", 0] }] },
          redeemedPoints: { $multiply: ["$pointsRedeemed", { $ifNull: ["$batchData.RedeemablePoints", 0] }] },
          redeemedValue: { $multiply: ["$cashRedeemed", { $ifNull: ["$batchData.value", 0] }] }
        }
      },
      { $sort: { createdAt: -1 } }
    ];

    const statistics = await Transaction.aggregate(pipeline);

    // Create maps for fast lookup of BrandStr and ProductStr by batch _id
    const batchMap = new Map();
    batches.forEach(b => {
      batchMap.set(b._id.toString(), {
        BrandStr: b.BrandStr || "Unknown",
        ProductStr: b.ProductStr || "Unknown",
        Branch: b.Branch || "Unknown",
        BatchNumber: b.BatchNumber || "Unknown",
        createdAt: b.createdAt || new Date()
      });
    });

    // Format data for response
    const barChartData = {
      products: statistics.map(stat => {
        const batchInfo = batchMap.get(stat._id.toString()) || {};
        return {
          name: `${batchInfo.BrandStr}-${batchInfo.ProductStr}-${batchInfo.Branch}-${batchInfo.BatchNumber}`,
          id: stat._id.toString(),
          createdAt: Math.floor(new Date(batchInfo.createdAt).getTime() / 1000)
        };
      }),
      metrics: [
        {
          name: "Issued Points",
          data: statistics.map(stat => stat.issuedPoints || 0)
        },
        {
          name: "Issued Cash",
          data: statistics.map(stat => stat.issuedValue || 0)
        },
        {
          name: "Redeemed Points",
          data: statistics.map(stat => stat.redeemedPoints || 0)
        },
        {
          name: "Redeemed Cash",
          data: statistics.map(stat => stat.redeemedValue || 0)
        }
      ]
    };

    return res.status(200).json(barChartData);

  } catch (error) {
    console.error("Error getting batch statistics:", error);
    return res.status(500).json({ error: error.message });
  }
};

exports.getBatchStatisticsList = async (req, res) => {
  try {
    const { page = 1, limit = 10, branches = [] } = req.body;
    const skip = (page - 1) * limit;

    logger.debug(`getBatchStatisticsList called with page=${page}, limit=${limit}, branches=${JSON.stringify(branches)}`);

    // Fetch all batches with required fields and joins
    const batches = await BatchNumber.aggregate([
      {
        $addFields: {
          BrandObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$Brand", null] },
                  { $ne: [{ $type: "$Brand" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$Brand" },
              else: "$Brand"
            }
          },
          ProductNameObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$ProductName", null] },
                  { $ne: [{ $type: "$ProductName" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$ProductName" },
              else: "$ProductName"
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "BrandObjId",
          foreignField: "_id",
          as: "productDataNew"
        }
      },
      {
        $lookup: {
          from: "brands",
          localField: "ProductNameObjId",
          foreignField: "_id",
          as: "brandDataNew"
        }
      },
      {
        $lookup: {
          from: "brands",
          localField: "BrandObjId",
          foreignField: "_id",
          as: "brandDataOld"
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "ProductNameObjId",
          foreignField: "_id",
          as: "productDataOld"
        }
      },
      {
        $project: {
          _id: 1,
          BatchNumber: 1,
          Branch: 1,
          Brand: 1,
          ProductName: 1,
          RedeemablePoints: 1,
          value: 1,
          createdAt: 1,
          BrandStr: {
            $cond: [
              { $gt: [{ $size: "$brandDataNew" }, 0] },
              { $arrayElemAt: ["$brandDataNew.name", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$brandDataOld" }, 0] },
                  { $arrayElemAt: ["$brandDataOld.name", 0] },
                  "$Brand"
                ]
              }
            ]
          },
          ProductStr: {
            $cond: [
              { $gt: [{ $size: "$productDataNew" }, 0] },
              { $arrayElemAt: ["$productDataNew.products", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$productDataOld" }, 0] },
                  { $arrayElemAt: ["$productDataOld.products", 0] },
                  "$ProductName"
                ]
              }
            ]
          }
        }
      }
    ]);

    logger.debug(`Fetched ${batches.length} batches`);

    // Convert _id to ObjectId safely
    const batchIds = batches.map(batch => {
      if (typeof batch._id === 'string') {
        return new mongoose.Types.ObjectId(batch._id);
      }
      return batch._id;
    });

    // Base match only on batchIds (branch filtering will come later)
    const baseMatch = {
      batchId: { $in: batchIds }
    };

    // Branches filter stages - empty if no branches provided
    const branchFilterStages = branches.length > 0
      ? [{ $match: { "batchData.Branch": { $in: branches } } }]
      : [];

    // Pipeline to get distinct branches
    const branchPipeline = [
      { $match: baseMatch },
      {
        $lookup: {
          from: "batchnumbers",
          localField: "batchId",
          foreignField: "_id",
          as: "batchData"
        }
      },
      { $unwind: "$batchData" },
      ...branchFilterStages,
      {
        $group: { _id: "$batchData.Branch" }
      },
      {
        $match: { _id: { $ne: null } }
      },
      {
        $project: { _id: 0, branch: "$_id" }
      }
    ];

    // Aggregation pipeline for transaction stats
    const aggregationPipeline = [
      { $match: baseMatch },
      {
        $lookup: {
          from: "batchnumbers",
          localField: "batchId",
          foreignField: "_id",
          as: "batchData"
        }
      },
      { $unwind: "$batchData" },
      ...branchFilterStages,
      {
        $group: {
          _id: "$batchId",
          quantity: { $sum: 1 },
          pointsRedeemed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $type: "$pointsRedeemedBy" }, "missing"] },
                    { $ne: ["$pointsRedeemedBy", null] },
                    { $ne: ["$pointsRedeemedBy", ""] }
                  ]
                },
                1,
                0
              ]
            }
          },
          cashRedeemed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $type: "$cashRedeemedBy" }, "missing"] },
                    { $ne: ["$cashRedeemedBy", null] },
                    { $ne: ["$cashRedeemedBy", ""] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ];

    // Count total documents matching
    const countPipeline = [...aggregationPipeline, { $count: "total" }];

    // Pagination pipeline
    const dataPipeline = [
      ...aggregationPipeline,
      { $skip: skip },
      { $limit: parseInt(limit) }
    ];

    // Run all aggregations in parallel
    const [countResult, stats, distinctBranches] = await Promise.all([
      Transaction.aggregate(countPipeline),
      Transaction.aggregate(dataPipeline),
      Transaction.aggregate(branchPipeline)
    ]);

    const total = countResult[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Map aggregation stats back to batch details
    const listData = stats.map(item => {
      const batch = batches.find(b => b._id.toString() === item._id.toString()) || {};
      const productStr = batch.ProductStr || "Unknown";
      const brandStr = batch.BrandStr || "Unknown";
      const batchNumber = batch.BatchNumber || "Unknown";
      const branch = batch.Branch || "Unknown";
      const createdAt = batch.createdAt || new Date();
      const redeemablePoints = batch.RedeemablePoints || 0;
      const value = batch.value || 0;

      return {
        name: `${productStr}-${brandStr}-${branch}-${batchNumber}`,
        branch: branch,
        createdAt: new Date(createdAt).toISOString(),
        issuedPoints: item.quantity * redeemablePoints,
        issuedCash: item.quantity * value,
        redeemedPoints: item.pointsRedeemed * redeemablePoints,
        redeemedCash: item.cashRedeemed * value
      };
    });

    // Sort branches alphabetically
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
    logger.error("Error in getBatchStatisticsList", error);
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

    // Step 1: Fetch all batches with resolved BrandStr and ProductStr
    const batches = await BatchNumber.aggregate([
      {
        $addFields: {
          BrandObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$Brand", null] },
                  { $ne: [{ $type: "$Brand" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$Brand" },
              else: "$Brand"
            }
          },
          ProductNameObjId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$ProductName", null] },
                  { $ne: [{ $type: "$ProductName" }, "objectId"] }
                ]
              },
              then: { $toObjectId: "$ProductName" },
              else: "$ProductName"
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "BrandObjId",
          foreignField: "_id",
          as: "productDataNew"
        }
      },
      {
        $lookup: {
          from: "brands",
          localField: "ProductNameObjId",
          foreignField: "_id",
          as: "brandDataNew"
        }
      },
      {
        $lookup: {
          from: "brands",
          localField: "BrandObjId",
          foreignField: "_id",
          as: "brandDataOld"
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "ProductNameObjId",
          foreignField: "_id",
          as: "productDataOld"
        }
      },
      {
        $project: {
          _id: 1,
          BatchNumber: 1,
          Branch: 1,
          createdAt: 1,
          RedeemablePoints: 1,
          value: 1,
          BrandStr: {
            $cond: [
              { $gt: [{ $size: "$brandDataNew" }, 0] },
              { $arrayElemAt: ["$brandDataNew.name", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$brandDataOld" }, 0] },
                  { $arrayElemAt: ["$brandDataOld.name", 0] },
                  "$Brand"
                ]
              }
            ]
          },
          ProductStr: {
            $cond: [
              { $gt: [{ $size: "$productDataNew" }, 0] },
              { $arrayElemAt: ["$productDataNew.products", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$productDataOld" }, 0] },
                  { $arrayElemAt: ["$productDataOld.products", 0] },
                  "$ProductName"
                ]
              }
            ]
          }
        }
      }
    ]);

    const batchIds = batches.map(b => b._id);

    // Step 2: Aggregate transactions per batch
    const pipeline = [
      { $match: { batchId: { $in: batchIds } } },
      {
        $lookup: {
          from: "batchnumbers",
          localField: "batchId",
          foreignField: "_id",
          as: "batchData"
        }
      },
      { $unwind: "$batchData" },
    ];

    // Branch filtering if any
    if (branches.length > 0) {
      pipeline.push({
        $match: {
          "batchData.Branch": { $in: branches }
        }
      });
    }

    // Continue aggregation
    pipeline.push(
      {
        $group: {
          _id: "$batchId",
          quantity: { $sum: 1 },
          pointsRedeemed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $type: "$pointsRedeemedBy" }, "missing"] },
                    { $ne: ["$pointsRedeemedBy", null] },
                    { $ne: ["$pointsRedeemedBy", ""] }
                  ]
                },
                1,
                0
              ]
            }
          },
          cashRedeemed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $type: "$cashRedeemedBy" }, "missing"] },
                    { $ne: ["$cashRedeemedBy", null] },
                    { $ne: ["$cashRedeemedBy", ""] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "batchnumbers",
          localField: "_id",
          foreignField: "_id",
          as: "batchInfo"
        }
      },
      { $unwind: "$batchInfo" },
      {
        $project: {
          _id: 1,
          quantity: 1,
          pointsRedeemed: 1,
          cashRedeemed: 1,
          createdAt: "$batchInfo.createdAt",
          batchNumber: "$batchInfo.BatchNumber",
          value: { $ifNull: ["$batchInfo.value", 0] },
          redeemablePoints: { $ifNull: ["$batchInfo.RedeemablePoints", 0] },
          branch: "$batchInfo.Branch"
        }
      },
      { $sort: { createdAt: -1 } }
    );

    const transactionStats = await Transaction.aggregate(pipeline);

    // Step 3: Map to export format
    const batchMap = new Map();
    batches.forEach(b => {
      batchMap.set(b._id.toString(), {
        BrandStr: b.BrandStr || "Unknown",
        ProductStr: b.ProductStr || "Unknown",
        Branch: b.Branch || "Unknown",
        BatchNumber: b.BatchNumber || "Unknown",
        createdAt: b.createdAt || new Date()
      });
    });

    const exportData = transactionStats.map(item => {
      const batch = batchMap.get(item._id.toString()) || {};

      return {
        'Name': `${batch.ProductStr}-${batch.BrandStr}-${batch.Branch}-${batch.BatchNumber}`,
        'Created Date': new Date(batch.createdAt).toISOString(),
        'Issued Points': item.quantity * item.redeemablePoints,
        'Issued Cash': item.quantity * item.value,
        'Redeemed Points': item.pointsRedeemed * item.redeemablePoints,
        'Redeemed Cash': item.cashRedeemed * item.value
      };
    });

    // Step 4: Generate CSV
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
