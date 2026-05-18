const Deal = require('../models/deals.model');
const s3 = require('../config/aws');
const { decodeBase64Image } = require('../services/utils.service');
const logger = require('../utils/logger');
const UserModel = require('../models/User');

const BUCKET = process.env.AWS_BUCKET_DEALS;

// POST /api/deals — admin only.
// Body: { title, description?, expirationDate, active?, category, dealImage (data URI) }
exports.createDeal = async (req, res) => {
    try {
        const { title, description, expirationDate, active, category, dealImage } = req.body;

        if (!title || !expirationDate || !category) {
            return res.status(400).json({ message: 'title, expirationDate and category are required' });
        }
        if (!dealImage) {
            return res.status(400).json({ message: 'Image is required' });
        }

        const imageData = await decodeBase64Image(dealImage);
        if (imageData instanceof Error) {
            return res.status(400).json({ message: 'Invalid image data' });
        }

        // Save the doc first so we have an _id for the S3 key.
        const deal = new Deal({
            title,
            description: description || undefined,
            expirationDate,
            active: active !== undefined ? !!active : true,
            category,
            dealImageUrl: 'pending', // overwritten right after upload
            createdBy: req.user && req.user.mobile,
        });
        const savedDeal = await deal.save();

        const params = {
            Bucket: BUCKET,
            Key: `${savedDeal._id}.png`,
            Body: imageData.data,
            ContentType: imageData.type,
            ACL: 'public-read',
        };
        const data = await s3.upload(params).promise();

        savedDeal.dealImageUrl = data.Location;
        await savedDeal.save();

        return res.status(201).json(savedDeal);
    } catch (error) {
        logger.error('createDeal failed', { error: error.message });
        return res.status(500).json({ message: error.message });
    }
};

// GET /api/deals — admin only.
// Query: ?page=1&limit=20&active=true&category=<id>&search=foo
exports.getDeals = async (req, res) => {
    try {
        const page = parseInt(req.query.page || 1, 10);
        const limit = parseInt(req.query.limit || 20, 10);
        const skip = (page - 1) * limit;

        const filter = {};
        if (req.query.active !== undefined) {
            filter.active = req.query.active === 'true';
        }
        if (req.query.category) {
            filter.category = req.query.category;
        }
        if (req.query.search) {
            const escaped = req.query.search.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { title: { $regex: new RegExp(escaped, 'i') } },
                { description: { $regex: new RegExp(escaped, 'i') } },
            ];
        }

        const [data, total] = await Promise.all([
            Deal.find(filter).populate('category', 'categoryName').skip(skip).limit(limit).sort({ createdAt: -1 }),
            Deal.countDocuments(filter),
        ]);

        return res.status(200).json({
            data,
            total,
            pages: Math.ceil(total / limit) || 1,
            currentPage: page,
        });
    } catch (error) {
        logger.error('getDeals failed', { error: error.message });
        return res.status(500).json({ message: error.message });
    }
};

// GET /api/deals/:id — admin only.
exports.getDealById = async (req, res) => {
    try {
        const deal = await Deal.findById(req.params.id).populate('category', 'categoryName');
        if (!deal) return res.status(404).json({ message: 'Deal not found' });
        return res.status(200).json(deal);
    } catch (error) {
        logger.error('getDealById failed', { error: error.message });
        return res.status(500).json({ message: error.message });
    }
};

// PUT /api/deals/:id — admin only.
// Body: any subset of { title, description, expirationDate, active, category, dealImage (data URI) }
exports.updateDeal = async (req, res) => {
    try {
        const existing = await Deal.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'Deal not found' });

        const updates = {};
        if (req.body.title !== undefined) updates.title = req.body.title;
        if (req.body.description !== undefined) updates.description = req.body.description;
        if (req.body.expirationDate !== undefined) updates.expirationDate = req.body.expirationDate;
        if (req.body.active !== undefined) updates.active = !!req.body.active;
        if (req.body.category !== undefined) updates.category = req.body.category;
        if (req.user && req.user.mobile) updates.updatedBy = req.user.mobile;

        if (req.body.dealImage) {
            const imageData = await decodeBase64Image(req.body.dealImage);
            if (imageData instanceof Error) {
                return res.status(400).json({ message: 'Invalid image data' });
            }
            const params = {
                Bucket: BUCKET,
                Key: `${existing._id}.png`,
                Body: imageData.data,
                ContentType: imageData.type,
                ACL: 'public-read',
            };
            const data = await s3.upload(params).promise();
            updates.dealImageUrl = data.Location;
        }

        const deal = await Deal.findByIdAndUpdate(req.params.id, updates, { new: true })
            .populate('category', 'categoryName');
        return res.status(200).json(deal);
    } catch (error) {
        logger.error('updateDeal failed', { error: error.message });
        return res.status(500).json({ message: error.message });
    }
};

// DELETE /api/deals/:id — admin only.
exports.deleteDeal = async (req, res) => {
    try {
        const deal = await Deal.findById(req.params.id);
        if (!deal) return res.status(404).json({ message: 'Deal not found' });

        // Best-effort S3 cleanup. Log on failure but proceed with the DB delete.
        try {
            await s3.deleteObject({ Bucket: BUCKET, Key: `${deal._id}.png` }).promise();
        } catch (s3Err) {
            logger.warn('deleteDeal: S3 object delete failed', { id: deal._id.toString(), error: s3Err.message });
        }

        await Deal.findByIdAndDelete(req.params.id);
        return res.status(200).json({ message: 'Deal deleted successfully' });
    } catch (error) {
        logger.error('deleteDeal failed', { error: error.message });
        return res.status(500).json({ message: error.message });
    }
};

// GET /api/deals/active — authenticated, any role.
// Returns deals where active=true, expirationDate>=now, category in user.productCategories.
exports.getActiveDealsForUser = async (req, res) => {
    try {
        // Re-fetch the user to get productCategories (JWT may not carry it).
        const user = await UserModel.findById(req.user._id).select('productCategories').lean();
        const categories = (user && user.productCategories) || [];

        if (categories.length === 0) {
            return res.status(200).json([]);
        }

        const now = new Date();
        const deals = await Deal.find({
            active: true,
            expirationDate: { $gte: now },
            category: { $in: categories },
        })
            .select('_id title dealImageUrl expirationDate updatedAt')
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json(deals);
    } catch (error) {
        logger.error('getActiveDealsForUser failed', { error: error.message });
        return res.status(500).json({ message: error.message });
    }
};
