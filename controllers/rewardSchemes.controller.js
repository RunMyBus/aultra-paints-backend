const rewardSchemesModel = require('../models/rewardSchemes.model');
const AWS = require('aws-sdk');
const {decodeBase64Image} = require('../services/utils.service');
const s3 = require("../config/aws");
const multer = require("multer");

exports.createRewardScheme = async (req, res) => {
    const {rewardSchemeStatus} = req.body;
    if (!req.body.rewardSchemeImage) {
        return res.status(400).json('Reward scheme image is required');
    }
    const imageData = await decodeBase64Image(req.body.rewardSchemeImage);
    if (imageData instanceof Error) {
        return res.status(400).json({message: 'InvalidRewardScheme image data'});
    }
    const newRewardScheme = new rewardSchemesModel({rewardSchemeStatus});

    try {
        let savedRewardScheme = await newRewardScheme.save();

        /*const s3 = new AWS.S3({
            region: process.env.AWS_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });*/

        const params = {
            Bucket: process.env.AWS_BUCKET_REWARD_SCHEME,
            Key: `${savedRewardScheme._id}.png`,
            Body: imageData.data,
            ContentType: imageData.type,
            ACL: 'public-read'
        };

        const data = await s3.upload(params).promise();
        savedRewardScheme = await rewardSchemesModel.updateOne({_id: savedRewardScheme._id}, {$set: {rewardSchemeImageUrl: data.Location}});
        res.status(201).json(savedRewardScheme);
    } catch (error) {
        console.error(error);
        if (error instanceof multer.MulterError) {
            // Handle Multer-specific errors
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File size exceeds 4 MB!' });
            }
        } else {
            res.status(500).json({error: error.message});
        }
    }
}

exports.searchRewardSchemes = async (req, res) => {
    const { page = 1, limit = 10, searchQuery = '' } = req.body;
    
    try {
        const skip = (page - 1) * limit;
        const query = searchQuery ? { name: { $regex: searchQuery, $options: 'i' } } : {};

        const data = await rewardSchemesModel.find(query)
            .skip(skip)
            .limit(Number(limit))
            .sort({ createdAt: -1 });

        const totalSchemes = await rewardSchemesModel.countDocuments(query);

        res.status(200).json({
            data,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalSchemes / limit),
                totalSchemes,
                limit,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};



exports.getRewardSchemes = async (req, res) => {
    try {
        const rewardSchemes = await rewardSchemesModel.find({"rewardSchemeStatus" : "Active"}).sort({createdAt: -1});
        res.status(200).json(rewardSchemes);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: error.message});
    }
}

exports.getRewardSchemeById = async (req, res) => {
    const id = req.params.id;
    try {
        const rewardScheme = await rewardSchemesModel.findById(id);
        if (!rewardScheme) {
            return res.status(404).json({error: 'Reward Scheme not found'});
        }
        res.status(200).json(rewardScheme);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: error.message});
    }
};

exports.updateRewardScheme = async (req, res) => {
    const id = req.params.id;
    const { rewardSchemeStatus } = req.body;
    try {
        if (req.body.rewardSchemeImage) {
            /*const s3 = new AWS.S3({
                region: process.env.AWS_REGION,
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            });*/
            if (req.body.rewardSchemeImageUrl) {
                let imgUrlSplit = req.body.rewardSchemeImageUrl.split('/')[req.body.rewardSchemeImageUrl.split('/').length - 1];
                const paramsRemove = {
                    Bucket: process.env.AWS_BUCKET_REWARD_SCHEME,
                    Key: imgUrlSplit,
                };
                await s3.deleteObject(paramsRemove).promise();
            }

            const imageData = await decodeBase64Image(req.body.rewardSchemeImage);
            const params = {
                Bucket: process.env.AWS_BUCKET_REWARD_SCHEME,
                Key: `${id}.png`,
                Body: imageData.data,
                ContentType: imageData.type,
                ACL: 'public-read'
            };

            const data = await s3.upload(params).promise();
            req.body.rewardSchemeImageUrl = data.Location;
        }

        const updatedRewardScheme = await rewardSchemesModel.findByIdAndUpdate(id, {rewardSchemeStatus, rewardSchemeImageUrl: req.body.rewardSchemeImageUrl}, {new: true});
        res.status(200).json(updatedRewardScheme);
    } catch (error) {
        console.error(error);
        if (error instanceof multer.MulterError) {
            // Handle Multer-specific errors
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File size exceeds 4 MB!' });
            }
        } else {
            res.status(500).json({error: error.message});
        }
    }
};

exports.deleteRewardScheme = async (req, res) => {
    const id = req.params.id;
    try {
        const deletedRewardScheme = await rewardSchemesModel.findByIdAndDelete(id);
        if (!deletedRewardScheme) {
            return res.status(404).json({error: 'Reward Scheme not found'});
        }
        res.status(200).json(deletedRewardScheme);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: error.message});
    }
}