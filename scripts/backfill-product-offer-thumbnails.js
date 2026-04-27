require('dotenv').config();
global.config = process.env;
require('../database/mongoose');
const axios = require('axios');
const sharp = require('sharp');
const s3 = require('../config/aws');
const productOffersModel = require('../models/productOffers.model');

async function generateThumbnail(imageBuffer) {
    return sharp(imageBuffer)
        .resize({ width: 300, withoutEnlargement: true })
        .png()
        .toBuffer();
}

function parseLimit() {
    const arg = process.argv[2];
    if (arg === undefined) return null;
    const n = parseInt(arg, 10);
    if (isNaN(n) || n <= 0) {
        console.error(`Invalid limit "${arg}". Pass a positive integer or omit for all offers.`);
        process.exit(1);
    }
    return n;
}

function pickRandom(arr, n) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
}

async function backfill() {
    const limit = parseLimit();

    let offers = await productOffersModel.find({
        productOfferImageUrl: { $exists: true, $ne: null },
        productOfferThumbnailUrl: { $exists: false }
    });

    console.log(`Found ${offers.length} offer(s) missing a thumbnail.`);

    if (limit !== null) {
        offers = pickRandom(offers, limit);
        console.log(`Sampling ${offers.length} random offer(s) (--limit ${limit}).`);
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const offer of offers) {
        try {
            const response = await axios.get(offer.productOfferImageUrl, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(response.data);

            const thumbnailBuffer = await generateThumbnail(imageBuffer);

            const thumbParams = {
                Bucket: process.env.AWS_BUCKET_PRODUCT_OFFER,
                Key: `${offer._id}_thumbnail.png`,
                Body: thumbnailBuffer,
                ContentType: 'image/png',
                ACL: 'public-read'
            };
            const thumbData = await s3.upload(thumbParams).promise();

            await productOffersModel.updateOne(
                { _id: offer._id },
                { $set: { productOfferThumbnailUrl: thumbData.Location } }
            );

            console.log(`[OK]   ${offer._id} → ${thumbData.Location}`);
            processed++;
        } catch (err) {
            console.error(`[FAIL] ${offer._id}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\nDone. processed=${processed}  skipped=${skipped}  failed=${failed}`);
    process.exit(0);
}

backfill().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
