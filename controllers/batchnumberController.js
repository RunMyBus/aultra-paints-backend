const mongoose = require('mongoose');
const Batch = require('../models/batchnumber');
const Transaction = require('../models/Transaction');
const sequenceModel = require('../models/sequence.model');
const {v4: uuidv4} = require('uuid');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
const {ObjectId} = require("mongodb");
// const {config} = require("dotenv");
const CouponCodes = require('../models/CouponCodes');
const s3 = require("../config/aws");
const logger = require('../utils/logger'); // Import the configured logger

async function uploadQRCodeToS3(qrCodeData, key) {
    const params = {
        Bucket: 'aultra-paints',
        Key: key,
        Body: qrCodeData,
        ContentType: 'image/png',
        ACL: 'public-read'
    };

    try {
        const response = await s3.upload(params).promise();
        logger.info('QR code uploaded to S3 successfully.');
        return response.Location; // Return the S3 URL
    } catch (error) {
        logger.error('Error uploading QR code to S3:', error);
        throw error;
    }
}

exports.uploadAudioToS3 = async (req, res) => {
    var now = new Date();
    var timeLabel =  ((now.getMonth() + 1) + '_' + (now.getDate()) + '_' + now.getFullYear() + "_" + now.getHours() + '_' + ((now.getMinutes() < 10) ? ("0" + now.getMinutes()) : (now.getMinutes())));
    const params = {
        Bucket: 'my-audio-files',
        Key: timeLabel,
        Body: req.audioFile,
        ContentType: 'audio/mpeg3',
        ACL: 'public-read'
    };

    try {
        const response = await s3.upload(params).promise();
        logger.info('Audio uploaded to S3 successfully.');
        return response.Location; // Return the S3 URL
    } catch (error) {
        logger.error('Error uploading Audio  to S3:', error);
        throw error;
    }
}

preFillZeros = async (number, length) => {
    return number.toString().padStart(length, '0');
}

exports.createBatchNumberWithCouponCheck = async (req, res) => {
    try {
        let userId = req.user.id.toString();
        const { Branch, Brand, CreationDate, ExpiryDate, BatchNumbers, BatchNumber } = req.body;

        let successArray = [];
        let errorArray = [];

        for (let batchNumber of BatchNumbers) {
            const { CouponSeries, ProductName, redeemablePoints, value, Volume, Quantity } = batchNumber;

            const startCouponSeries = parseInt(CouponSeries);
            const endCouponSeries = parseInt(CouponSeries) + Quantity - 1;

            try {
                // Check if the batch number already exists
                const existingBatch = await Batch.findOne({ BatchNumber });
                if (existingBatch) {
                    return res.status(400).json({
                        error: `Batch number ${BatchNumber} already exists.`,
                    });
                }
                // Fetch all coupons in the specified range
                const couponsInRange = await Transaction.find({
                    couponCode: { $gte: startCouponSeries, $lte: endCouponSeries },
                });
                // Check if any coupon in the range is consumed
                const consumedCoupons = couponsInRange.filter(coupon =>
                    coupon.batchId
                );
                if (consumedCoupons.length > 0) {
                    return res.status(400).json({
                        error: `${CouponSeries} series already consumed.`,
                    });
                }
                // Ensure the requested quantity of coupons is available
                if (couponsInRange.length < Quantity) {
                    return res.status(400).json({
                        error: `Not enough coupons are available for this ${CouponSeries} series.`,
                    });
                }

                // Create the batch
                const batch = new Batch({
                    Branch,
                    ProductName,
                    CreationDate,
                    ExpiryDate,
                    startCouponSeries,
                    endCouponSeries,
                    Brand,
                    RedeemablePoints: redeemablePoints,
                    value,
                    Volume,
                    Quantity,
                    BatchNumber,
                });

                let batchResult = await batch.save();
                let updatedCoupons = [];

                for (let i = 0; i < couponsInRange.length; i++) {
                    let coupon = couponsInRange[i];
                    const customUrl = `${config.redeemUrl}/redeem.html?tx=${coupon.UDID}`;
                    const qrCodeData = await QRCode.toBuffer(customUrl);
                    const qrCodeKey = `${batchResult._id}-${coupon.UDID}.png`;
                    const qrCodeUrl = await uploadQRCodeToS3(qrCodeData, qrCodeKey);
                    // update the coupon
                    coupon.batchId = batchResult._id;
                    coupon.redeemablePoints = batchResult.RedeemablePoints;
                    coupon.value = batchResult.value;
                    coupon.qr_code = qrCodeUrl;
                    coupon.createdBy = userId;
                    coupon = await coupon.save();
                    updatedCoupons.push(coupon);
                }
                batchResult.transactions = updatedCoupons;
                successArray.push(batchResult);
            } catch (error) {
                logger.error(error);
                errorArray.push({ batchNumber, error: error.message });
            }
        }

        return res.status(200).json({ success: successArray, error: errorArray });
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ error: error.message });
    }
};
exports.getAllBatchNumbers = async (req, res) => {
    logger.info('Starting getAllBatchNumbers request', {
        page: req.body.page,
        limit: req.body.limit,
        searchQuery: req.body.searchQuery
    });
    try {
        const page = parseInt(req.body.page) || 1;
        const limit = parseInt(req.body.limit) || 10;
        const skip = (page - 1) * limit;

        // Build the match query
        let matchQuery = {};
        if (req.body.searchQuery) {
            const searchRegex = new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
            matchQuery = {
                $or: [
                    { Branch: { $regex: searchRegex } },
                    { BatchNumber: { $regex: searchRegex } }
                ]
            };
        }

        // Use aggregation pipeline
        const result = await Batch.aggregate([
            { $match: matchQuery }, // Filter documents
            {
                $facet: {
                    metadata: [{ $count: "total" }], // Count total documents
                    data: [
                        { $skip: skip }, // Skip for pagination
                        { $limit: limit } // Limit for pagination
                    ]
                }
            }
        ]);

        // Extract metadata and data
        const total = result[0]?.metadata[0]?.total || 0;
        const branches = result[0]?.data || [];

        return res.status(200).json({
            total,
            pages: Math.ceil(total / limit),
            currentPage: page,
            branches
        });
    } catch (error) {
        return res.status(500).json({ message: 'Error retrieving branches', error: error.message });
    }
};

exports.getAllBatchNumbers = async (req, res) => {
  logger.info('Starting getAllBatchNumbers request', {
    page: req.body.page,
    limit: req.body.limit,
    searchQuery: req.body.searchQuery
  });

  try {
    const page = parseInt(req.body.page) || 1;
    const limit = parseInt(req.body.limit) || 10;
    const skip = (page - 1) * limit;

    let matchQuery = {};
    if (req.body.searchQuery) {
      const searchRegex = new RegExp(
        req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      matchQuery = {
        $or: [
          { Branch: { $regex: searchRegex } },
          { BatchNumber: { $regex: searchRegex } }
        ]
      };
    }

    const result = await Batch.aggregate([
      { $match: matchQuery },

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
          Branch: 1,
          CreationDate: 1,
          ExpiryDate: 1,
          BatchNumber: 1,
          ProductName: 1,
          Brand: 1,
          value: 1,
          Volume: 1,
          Quantity: 1,
          RedeemablePoints: 1,
          startCouponSeries: 1,
          endCouponSeries: 1,

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
      },

      {
        $facet: {
          data: [
            { $sort: { CreationDate: -1 } },
            { $skip: skip },
            { $limit: limit }
          ],
          metadata: [
            { $count: "total" }
          ]
        }
      }
    ]);

    const total = result[0]?.metadata[0]?.total || 0;
    const branches = result[0]?.data || [];

    return res.status(200).json({
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      branches
    });

  } catch (error) {
    logger.error('Error in getAllBatchNumbers', error);
    return res.status(500).json({ message: 'Error retrieving batch numbers', error: error.message });
  }
};

exports.getBranchByBatchNumber = async (req, res) => {
    const {BatchNumber} = req.params;

    try {
        const branch = await Batch.findOne({BatchNumber});

        if (!branch) {
            return res.status(404).json({message: 'Branch/product not found by BatchNumber'});
        }

        res.status(200).json(branch);
    } catch (error) {
        res.status(500).json({message: 'Error retrieving branch by BatchNumber', error: error.message});
    }
};

// Update a branch by BatchNumber and all its product information
exports.updateBatchNumber = async (req, res) => {
    const id = req.params.id;
    const updatedData = req.body;

    try {
        const updatedBranch = await Batch.findOne({_id: new ObjectId(id)});

        if (!updatedBranch) {
            return res.status(404).json({message: 'Branch with the given BatchNumber not found'});
        }


        Object.keys(updatedData).forEach((key) => {
            updatedBranch[key] = updatedData[key];
        });

        const savedBranch = await updatedBranch.save();
        return res.status(200).json(savedBranch);

    } catch (error) {
        return res.status(500).json({message: 'Error updating branch and product', error: error.message});
    }
};

exports.branchDeletedAffectedCouponsCount = async (req, res) => {
    try {
        const couponCount = await Transaction.countDocuments({batchId: new ObjectId(req.params.id)});
        return res.status(200).json({message: `Batch deleted, ${couponCount} coupons affected.`});
    } catch (error) {
        console.log(error)
        return res.status(500).json({message: 'Error delete count', error: error.message});
    }
}


// Delete a branch/product by BatchNumber
exports.deleteBranchByBatchNumber = async (req, res) => {
    try {
        const deletedBranch = await Batch.findOneAndDelete({_id: new ObjectId(req.params.id)});
        if (!deletedBranch) {
            return res.status(404).json({message: 'Batch not found'});
        }
        return res.status(200).json({message: 'Batch deleted successfully'});
    } catch (error) {
        return res.status(500).json({message: 'Error deleting Batch', error: error.message});
    }
};

// Fetch all Batch Numbers and CouponSeries
// exports.getAllBatchNumbers = async (req, res) => {
//   try {
//     const batchNumbers = await Batch.find().select('BatchNumber Brand ProductName Volume Quantity CouponSeries');
//     res.status(200).json(batchNumbers);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch batch numbers', details: error.message });
//   }
// };

// Fetch CouponSeries from BatchNumbers
exports.getCouponSeries = async (req, res) => {
    try {
        const batchNumbers = await Batch.find().distinct('CouponSeries');
        return res.status(200).json(batchNumbers);
    } catch (error) {
        console.log(err)
        return res.status(500).json({error: 'Failed to fetch coupon series', details: error.message});
    }
};

