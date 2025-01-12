const productOffersModel = require('../models/productOffers.model');
const AWS = require('aws-sdk');
const { decodeBase64Image } = require('../services/utils.service');


// Create a new productOffer
exports.createProductOffer = async (req, res) => {
    const {productOfferDescription, productOfferTitle, productOfferValidation, productOfferStatus} = req.body;
    if (!req.body.productOfferImage) {
        return res.status(400).json({message: 'Product offer image is required'});
    }
    const imageData = await decodeBase64Image(req.body.productOfferImage);

    if (imageData instanceof Error) {
        return res.status(400).json({ message: 'Invalid image data' });
    }

    const productOffer = new productOffersModel({
        productOfferDescription,
        productOfferTitle,
        productOfferValidation,
        productOfferStatus,
    });

    try {
        // Check if the productOfferTitle already exists
        const existingProductOffer = await productOffersModel.findOne({productOfferTitle});
        if (existingProductOffer) {
            return res.status(400).json({message: 'Product offer with the same title already exists.'});
        }
        let savedProductOffer = await productOffer.save();

        const s3 = new AWS.S3({
            region: process.env.AWS_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });

        const params = {
            Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
            Key: `${savedProductOffer._id}.png`,
            Body: imageData.data,
            ContentType: imageData.type,
        };

        const data = await s3.upload(params).promise();
        savedProductOffer = await productOffersModel.updateOne({_id: savedProductOffer._id}, {$set: {productOfferImageUrl: data.Location}});
        return res.status(201).json(savedProductOffer);
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: error.message});
    }
};

// Get all productOffers
exports.getProductOffers = async (req, res) => {
    try {
        const productOffers = await productOffersModel.find().sort({createdAt: -1});
        res.status(200).json(productOffers);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}

exports.searchProductOffers = async (req, res) => {
    try {
        let page = parseInt(req.body.page || 1);
        let limit = parseInt(req.body.limit || 10);
        let query = {};
        if (req.body.searchQuery) {
            query['$or'] = [
                {'productOfferTitle': {$regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'productOfferDescription': {$regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
            ];
        }
        let data = await productOffersModel.find(query).skip((page - 1) * limit).limit(parseInt(limit));
        const totalOffers = await productOffersModel.countDocuments(query);
        return res.status(200).json({
            data,
            total: totalOffers,
            pages: Math.ceil(totalOffers / limit),
            currentPage: page
        });
    } catch (err) {
        return res.status(500).json({message: "Something went wrong"});
    }
}

// Get a productOffer by ID
exports.getProductOfferById = async (req, res) => {
    try {
        const productOffer = await productOffersModel.findById(req.params.id);
        if (!productOffer) {
            return res.status(404).json({message: 'ProductOffer not found'});
        }
        res.status(200).json(productOffer);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}

// Update a productOffer by ID
exports.updateProductOffer = async (req, res) => {
    try {
        const existingProductOffer = await productOffersModel.findOne({productOfferTitle: req.body.productOfferTitle, _id: {$ne: req.params.id}});
        if (existingProductOffer) {
            return res.status(400).json({message: 'Product offer with the same title already exists.'});
        }
        if (req.body.productOfferImage) {
            const s3 = new AWS.S3({
                region: process.env.AWS_REGION,
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            });
            let imgUrlSplit = req.body.productOfferImageUrl.split('/')[req.body.productOfferImageUrl.split('/').length - 1];
            const paramsRemove = {
                Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
                Key: imgUrlSplit,
            };
            await s3.deleteObject(paramsRemove).promise();

            const imageData = await decodeBase64Image(req.body.productOfferImage);
            const params = {
                Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
                Key: `${req.params.id}.png`,
                Body: imageData.data,
                ContentType: imageData.type,
            };

            const data = await s3.upload(params).promise();
            req.body.productOfferImageUrl = data.Location;
        }
        const productOffer = await productOffersModel.findByIdAndUpdate(req.params.id, req.body, {new: true});
        if (!productOffer) {
            return res({status: 400, message: 'ProductOffer not found'});
        }
        return res({status: 200, data: productOffer});
    } catch (error) {
        console.log(error);
        return res({status: 500, message: error.message});
    }
}

// Delete a productOffer by ID
exports.deleteProductOffer = async (req, res) => {
    try {
        const productOffer = await productOffersModel.findByIdAndDelete(req.params.id);
        if (!productOffer) {
            return res.status(404).json({message: 'ProductOffer not found'});
        }
        res.status(200).json({message: 'ProductOffer deleted successfully'});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}