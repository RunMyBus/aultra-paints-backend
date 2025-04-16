const productCatlogModel = require('../models/productCatlog');
const AWS = require('aws-sdk');
const s3 = require("../config/aws");
const multer = require('multer');
const { decodeBase64Image } = require('../services/utils.service');
const ProductCatlogPrice = require('../models/productCatlogPrice.model');
const UserModel = require('../models/User');
const logger = require('../utils/logger');


// Create Product Catlog
exports.createProductCatlog = async (req, res) => {
    console.log('req body ---- ', req.body);
    let { productDescription, productStatus, price } = req.body;
  
    if (!req.body.productImage) {
      return res.status(400).json({ message: 'Product  image is required' });
    }
  
    // Decode the base64 image
    const imageData = await decodeBase64Image(req.body.productImage);
    if (imageData instanceof Error) {
      return res.status(400).json({ message: 'Invalid image data' });
    }
  
    // Parse and validate price field
    let parsedPrice;
    try {
      parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
      if (!Array.isArray(parsedPrice)) throw new Error();
  
      // Transform the price array to match the schema
      parsedPrice = parsedPrice.map(priceObj => {
        const [[refId, price]] = Object.entries(priceObj);
        return { refId, price };
      });
    } catch (error) {
      return res.status(400).json({ message: 'Invalid price format' });
    }
  
    // Create the product catlog document
    const productCatlog = new productCatlogModel({
      productDescription,
      productStatus,
      price: parsedPrice,
     
    });
  
    try {
      const existingProductCatlog = await productCatlogModel.findOne({ productDescription });
      if (existingProductCatlog) {
        return res.status(400).json({ message: 'Product catlog with the same description already exists' });
      }
  
      // Save the product catlog
      let savedProductCatlog = await productCatlog.save();
      const savedProductCatlogId = savedProductCatlog._id;
  
      // Upload the image to AWS S3
      const params = {
        Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
        Key: `${savedProductCatlogId}.png`, 
        Body: imageData.data,
        ContentType: imageData.type,
        ACL: 'public-read',
      };
  
      const data = await s3.upload(params).promise();
      savedProductCatlog = await productCatlogModel.updateOne(
        { _id: savedProductCatlog._id },
        { $set: { productImageUrl: data.Location } }
      );

      await processProductCatlogPrices(savedProductCatlogId , parsedPrice);
      
      return res.status(201).json(savedProductCatlog);
    } catch (error) {
      console.log(error);
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds the limit (4 MB)' });
        }
      } else {
        return res.status(500).json({ message: error.message });
      }
    }
  };


  const processProductCatlogPrices = async (productcatlogId, parsedPrice) => {
    try {
        // Remove existing prices for the product
        await ProductCatlogPrice.deleteMany({ productcatlogId });

        // Fetch all dealers
        const dealers = await UserModel.find({ accountType: 'Dealer' });

        // Prepare price entries for each dealer
        const productCatlogPrices = dealers.map(dealer => {
            const priceObj =
                parsedPrice.find(p => p.refId === dealer.district) ||
                parsedPrice.find(p => p.refId === dealer.zone) ||
                parsedPrice.find(p => p.refId === dealer.state) ||
                parsedPrice.find(p => p.refId === 'All');

            return priceObj ? {
                dealerId: dealer._id,
                productcatlogId,
                price: priceObj.price
            } : null;
        }).filter(entry => entry !== null); // Remove nulls

        if (productCatlogPrices.length > 0) {
            await ProductCatlogPrice.insertMany(productCatlogPrices);
        }

        logger.info("Product catalog prices updated successfully.");
    } catch (error) {
        console.error('Error while processing product catalog prices --- ', error);
        logger.error('Error while processing product catalog prices', {
            error: error.message,
            errorObj: JSON.stringify(error)
        });
    }
};

  exports.getProductCatlogs = async (req, res) => {
    try {
        let page = req.body.page || 1;
        let limit = req.body.limit || 10;

        const productCatlogs = await productCatlogModel.find({ productStatus: 'Active' })
            .skip((page - 1) * limit)  
            .limit(limit)  
            .sort({ createdAt: -1 });  

        res.status(200).json(productCatlogs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.searchProductCatlog = async (req, res) => {
  try {
    const page = parseInt(req.body.page || 1);
    const limit = parseInt(req.body.limit || 10);
    const dealerId = req.user._id.toString();
    const accountType = req.user.accountType; 
    let query = {};

    // Search by productDescription 
    if (req.body.searchQuery) {
      query['productDescription'] = {
        $regex: new RegExp(req.body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      };
    }

    const data = await productCatlogModel
      .find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await productCatlogModel.countDocuments(query);

    const updatedData = await Promise.all(data.map(async (productCatlog) => {
      let productPrice = null;

      if (accountType === 'SuperUser') {
        const priceObj = productCatlog.price?.find(p => p.refId === 'All');
        productPrice = priceObj ? priceObj.price : null;
      } else {
        const priceData = await ProductCatlogPrice.findOne({
          productcatlogId: productCatlog._id,
          dealerId: dealerId
        });
        productPrice = priceData ? priceData.price : null;
      }

      return {
        ...productCatlog._doc, 
        productPrice
      };
    }));

    return res.status(200).json({
      data: updatedData,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    console.error("Error in searchProductCatlog:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};


  exports.updateProductCatlog = async (req, res) => {
    console.log('req.body:', req.body);
    try {
        const existingProductCatlog = await productCatlogModel.findOne({
            productDescription: req.body.productDescription,
            _id: { $ne: req.params.id }
        });
        if (existingProductCatlog) {
            return res.status(400).json({ message: 'Product catlog with the same description already exists.' });
        }

        // Check if an image is being uploaded
        if (req.body.productImage) {
            if (req.body.productImageUrl) {
                let imgUrlSplit = req.body.productImageUrl.split('/').pop();
                const paramsRemove = {
                    Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
                    Key: imgUrlSplit,
                };
                await s3.deleteObject(paramsRemove).promise();
            }

            // Decode the base64 image and upload it to S3
            const imageData = await decodeBase64Image(req.body.productImage);
            const params = {
                Bucket: process.env.AWS_BUCKET_PRODUCT_CATEGORY,
                Key: `${req.params.id}.png`,
                Body: imageData.data,
                ContentType: imageData.type,
                ACL: 'public-read'
            };

            const data = await s3.upload(params).promise();
            req.body.productImageUrl = data.Location;
        }

        // Price parsing logic
        let parsedPrice;
        try {
            const { price } = req.body;
            parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;

            if (!Array.isArray(parsedPrice)) {
                return res.status(400).json({ message: 'Price must be an array' });
            }

            parsedPrice = parsedPrice.map(priceObj => {
                try {
                    const [[refId, price]] = Object.entries(priceObj);
                    return { refId, price };
                } catch (e) {
                    throw new Error('Invalid price object structure');
                }
            });
        } catch (priceError) {
            console.error('Price parsing error:', priceError);
            return res.status(400).json({ message: 'Invalid price format' });
        }

        // Data to update
        const productCatlogData = {
            productDescription: req.body.productDescription,
            productStatus: req.body.productStatus,
            productImageUrl: req.body.productImageUrl,
            updatedBy: req.body.updatedBy,
            price: parsedPrice
        };

        // Update the product catlog and return the updated data
        const productCatlog = await productCatlogModel.findByIdAndUpdate(req.params.id, productCatlogData, { new: true });
        if (!productCatlog) {
            return res.status(400).json({ message: 'Product catlog not found' });
        }

        await processProductCatlogPrices(req.params.id , parsedPrice);

        return res.status(200).json({ data: productCatlog });
    } catch (error) {
        console.log(error);
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File size exceeds 4 MB!' });
            }
        } else {
            return res.status(500).json({ message: error.message });
        }
    }
};

// Delete Product Catlog
exports.deleteProductCatlog = async (req, res) => {
  try {
      const productCatlog = await productCatlogModel.findByIdAndDelete(req.params.id);
      if (!productCatlog) {
          return res.status(404).json({ message: 'Product catlog not found' });
      }
      res.status(200).json({ message: 'Product catlog deleted successfully' });
  } catch (error) {
      res.status(500).json({ message: error.message });
  }
};

