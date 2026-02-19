const orderModel = require('../models/Order');
const logger = require('../utils/logger');
const config = process.env;
const InvoiceTemplate = require('../models/InvoiceTemplate');
const handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const productOffersModel = require("../models/productOffers.model");
const userModel = require("../models/User");
const { pushOrderToFocus8 } = require("../services/focus8Order.service");


async function generateInvoicePdf(order, user) {
    // 1. Fetch template from DB
    const templateDoc = await InvoiceTemplate.findOne({ name: 'order' });
    if (!templateDoc) throw new Error('Invoice template not found in DB');

    // 2. Compile template with Handlebars
    const template = handlebars.compile(templateDoc.html);

    // 3. Prepare data for the template
    const items = order.items.map(item => ({
        title: item.productOfferDescription,
        price: item.productPrice.toFixed(2),
        quantity: item.quantity,
        subtotal: (item.productPrice * item.quantity).toFixed(2)
    }));

    const data = {
        orderId: order.orderId,
        date: order.createdAt.toISOString().slice(0, 10),
        customerName: user.name,
        items,
        totalPrice: order.totalPrice.toFixed(2),
        gstPercentage: process.env.GST_PERCENTAGE || 5,
        gstPrice: order.gstPrice.toFixed(2),
        finalPrice: order.finalPrice.toFixed(2)
    };

    const html = template(data);

    // 4. Generate PDF with Puppeteer
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4' });
    await browser.close();

    // fs.writeFileSync('test-invoice.pdf', pdfBuffer);
    // console.log('PDF saved as test-invoice.pdf');

    return pdfBuffer;
}

async function getNextOrderId() {
    // Find the order with the highest orderId
    const latestOrder = await orderModel.findOne({ orderId: { $exists: true } })
        .sort({ createdAt: -1 }) // or { orderId: -1 } if orderId is always increasing
        .lean();

    let nextNumber = 1;
    if (latestOrder && latestOrder.orderId) {
        // Extract the numeric part, e.g., "ORD01" -> 1, "ORD12" -> 12
        const match = latestOrder.orderId.match(/^ORD(\d+)$/);
        if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
        }
    }

    // Pad with zeros as needed, e.g., ORD01, ORD02, ..., ORD10, etc.
    const padded = String(nextNumber).padStart(2, '0');
    return `ORD${padded}`;
}

exports.createOrder = async (req, res) => {
    try {
        let userId = req.user._id.toString();

        if (!['Dealer', 'SalesExecutive'].includes(req.user.accountType)) {
            return res.status(400).json({ success: false, message: 'Only dealers or sales executives can place orders.' });
        }

        if (req.user.accountType === 'SalesExecutive' && !req.body.dealerId) {
            return res.status(400).json({success: false, message: 'Dealer id is required when sales executive is placing order.'});
        }

        const { items, totalPrice, entityId = 1 } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No items provided for order.' });
        }

        // Populate missing focusProductId and focusUnitId
        const itemsMissingFocusData = items.filter(item => !item.focusProductId || !item.focusUnitId);

        if (itemsMissingFocusData.length > 0) {
            const productIds = itemsMissingFocusData.map(item => item._id).filter(id => id);

            if (productIds.length > 0) {
                const products = await productOffersModel.find({
                    _id: { $in: productIds }
                }).select('focusProductId focusUnitId focusProductMapping productOfferDescription');

                const productMap = products.reduce((acc, curr) => {
                    acc[curr._id.toString()] = {
                        focusProductId: curr.focusProductId,
                        focusUnitId: curr.focusUnitId,
                        focusProductMapping: curr.focusProductMapping,
                        productOfferDescription: curr.productOfferDescription
                    };
                    return acc;
                }, {});

                for (const item of items) {
                    if (item._id && productMap[item._id.toString()]) {
                        const productData = productMap[item._id.toString()];
                        
                        // Check if product has volume-specific mapping (grouping)
                        if (productData.focusProductMapping && productData.focusProductMapping.length > 0 && item.volume) {
                            // Find the mapping for this specific volume
                            const volumeMapping = productData.focusProductMapping.find(
                                mapping => mapping.volume === item.volume
                            );
                            
                            if (volumeMapping) {
                                if (!item.focusProductId) {
                                    item.focusProductId = volumeMapping.focusProductId;
                                    logger.info(`ORDER :: Using volume-specific Focus Product ID ${volumeMapping.focusProductId} for volume ${item.volume}`);
                                }
                                if (!item.focusUnitId) {
                                    item.focusUnitId = volumeMapping.focusUnitId || 1;
                                }
                            } else {
                                logger.warn(`ORDER :: No volume mapping found for volume ${item.volume} in product ${item._id}`);
                                // Fall back to legacy fields if volume mapping not found
                                if (!item.focusProductId && productData.focusProductId) {
                                    item.focusProductId = productData.focusProductId;
                                }
                                if (!item.focusUnitId && productData.focusUnitId) {
                                    item.focusUnitId = productData.focusUnitId;
                                }
                            }
                        } else {
                            return res.status(400).json({
                                success: false,
                                message: `No focus product mapping found for product ${item.productOfferDescription}`
                            });
                        }
                    }
                }
            }
        }

        // Calculate total price from items
        let calculatedTotalPrice = 0;
        items.forEach(item => {
            calculatedTotalPrice += (item.productPrice || 0) * (item.quantity || 1);
        });
        // check total price mismatch
        if (Number(calculatedTotalPrice.toFixed(2)) !== Number(Number(totalPrice).toFixed(2))) {
            return res.status(400).json({
                success: false,
                message: 'Price mismatch: totalPrice does not match the sum of item prices.'
            });
        }

        // GST Calculation
        const gstPercentage = parseFloat(config.GST_PERCENTAGE);
        const gstPrice = +(calculatedTotalPrice * (gstPercentage / 100)).toFixed(2);
        const finalPrice = +(calculatedTotalPrice + gstPrice).toFixed(2);

        const orderId = await getNextOrderId();

        // Determine order status based on who is creating the order
        let orderStatus = 'PENDING';
        let isVerified = false;
        
        if (req.user.accountType === 'SalesExecutive') {
            // Sales Executive orders are automatically verified
            orderStatus = 'VERIFIED';
            isVerified = true;
        }

        // Save order
        let orderObj = {
            orderId,
            items,
            totalPrice: calculatedTotalPrice,
            gstPrice,
            finalPrice,
            createdBy: userId || '',
            status: orderStatus,
            isVerified: isVerified
        };
        if (req.body.dealerId) {
            orderObj.dealerId = req.body.dealerId;
        }
        const order = new orderModel(orderObj);

        await order.save();

        let orderCreatedForDetails;

        if (req.body.dealerId) {
            orderCreatedForDetails = await userModel.findById(req.body.dealerId);
        } else {
            orderCreatedForDetails = req.user;
        }

        // Only push to Focus8 if the order is verified (i.e., created by SalesExecutive)
        // Dealer orders will be pushed to Focus8 after approval
        if (req.user.accountType === 'SalesExecutive') {
            pushOrderToFocus8(order, orderCreatedForDetails, entityId)
                .then(async (focusResult) => {
                    if (focusResult.success) {
                        order.focusSyncStatus = 'SUCCESS';
                        order.focusOrderId = focusResult.voucherNo; // Using VoucherNo as the ID reference
                        order.focusSyncResponse = focusResult.focus8Response;
                    } else {
                        order.focusSyncStatus = 'FAILED';
                        order.focusSyncResponse = focusResult.focus8Response;
                    }
                    await order.save();
                })
                .catch(async (focusError) => {
                    logger.error('Focus8 Push Failed for Order ' + orderId, focusError);
                    order.focusSyncStatus = 'FAILED';
                    order.focusSyncResponse = focusError.response?.data || { message: focusError.message };
                    await order.save();
                });
        }

        // const pdfBuffer = await generateInvoicePdf(order, req.user);

        return res.status(200).json({
            success: true,
            message: req.user.accountType === 'SalesExecutive' 
                ? 'Order created and verified successfully.' 
                : 'Order created successfully. Awaiting sales executive approval.',
            order: {
                orderId,
                items,
                totalPrice: calculatedTotalPrice,
                gstPrice,
                finalPrice,
                gstPercentage: parseFloat(config.GST_PERCENTAGE),
                status: orderStatus,
                isVerified: isVerified
            },
            // invoicePdfBase64: pdfBuffer.toString('base64')
        });
    } catch (error) {
        logger.error('Order creation failed ', error);
        return res.status(400).json({ success: false, message: error.message });
    }
};

exports.getOrders = async (req, res) => {
    try {
        const user = req.user;
        const { accountType } = user;
        const { page, limit } = req.body;

        // If the user is neither SuperUser nor Dealer, returning an empty array
        if (!['SuperUser', 'Dealer', 'SalesExecutive'].includes(accountType)) {
            return res.status(200).json({
                success: true,
                orders: [],
                total: 0,
                pages: 0,
                currentPage: page
            });
        }

        let query = {};
        let populateOptions = {
            path: 'createdBy',
            select: 'name mobile accountType'
        };
        let orders;
        let totalOrders;

        // If SuperUser, fetch all orders with user details
        if (accountType === 'SuperUser') {
            totalOrders = await orderModel.countDocuments(query);
            orders = await orderModel
                .find(query)
                .populate(populateOptions)
                .sort({ createdAt: -1 }) // Latest orders first
                .skip((page - 1) * limit)
                .limit(limit)
                .lean();
        } // If SalesExecutive, fetch orders from mapped dealers
        else if (accountType === 'SalesExecutive') {
            // First, find all dealers mapped to this sales executive
            const mappedDealers = await userModel.find(
                {
                    salesExecutive: user.mobile,
                    accountType: 'Dealer',
                    status: 'active'
                },
                '_id'
            ).lean();

            const dealerIds = mappedDealers.map(dealer => dealer._id);
            query = { $or: [{ createdBy: { $in: dealerIds } }, { dealerId: { $in: dealerIds } }] };
            totalOrders = await orderModel.countDocuments(query);
            orders = await orderModel
                .find(query)
                .populate({
                    path: 'createdBy',
                    select: 'name dealerCode mobile'
                })
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean();
        }
        else {
            // For Dealers, fetch only their orders
            // query = { createdBy: user._id };
            query = { $or: [{ createdBy: user._id }, { dealerId: user._id }] };
            totalOrders = await orderModel.countDocuments(query);
            orders = await orderModel
                .find(query)
                .populate(populateOptions)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean();
        }
        const totalPages = Math.ceil(totalOrders / limit);
        return res.status(200).json({
            success: true,
            orders,
            total: totalOrders,
            pages: totalPages,
            currentPage: page
        });
    } catch (error) {
        logger.error('Error fetching orders ', error);
        return res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderId, isVerified, entityId = 1 } = req.body;
        const user = req.user;

        // Check if the user is a SalesExecutive
        if (user.accountType !== 'SalesExecutive') {
            return res.status(403).json({
                success: false,
                message: 'Only Sales Executives can verify/reject orders'
            });
        }

        // Get mapped dealers for this sales executive
        const mappedDealers = await userModel.find(
            {
                salesExecutive: user.mobile,
                accountType: 'Dealer',
                status: 'active'
            },
            '_id'
        );
        const dealerIds = mappedDealers.map(dealer => dealer._id);

        // Find the order and verify it belongs to a mapped dealer
        const order = await orderModel.findOne({
            orderId: orderId,
            status: 'PENDING',
            createdBy: { $in: dealerIds }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or not authorized to modify this order'
            });
        }

        // Update the order status
        let updateData = {};
        if (isVerified === 1) {
            updateData = {
                status: 'VERIFIED',
                isVerified: true,
                isRejected: false
            };
        } else if (isVerified === 0) {
            updateData = {
                status: 'REJECTED',
                isVerified: false,
                isRejected: true
            };
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid action. Use 1 or 0 for verification/rejection.'
            });
        }

        // Update the order
        const updatedOrder = await orderModel.findOneAndUpdate(
            { orderId: orderId },
            updateData,
            {
                new: true,
                context: { userId: user._id } // This will be used by the updatedBy plugin
            }
        );

        // If order is verified, push to Focus8
        if (isVerified === 1) {
            // Get the dealer who created the order to use their details for Focus8
            const dealer = await userModel.findById(order.createdBy);
            
            if (dealer) {
                pushOrderToFocus8(updatedOrder, dealer, entityId)
                    .then(async (focusResult) => {
                        if (focusResult.success) {
                            updatedOrder.focusSyncStatus = 'SUCCESS';
                            updatedOrder.focusOrderId = focusResult.voucherNo;
                            updatedOrder.focusSyncResponse = focusResult.focus8Response;
                        } else {
                            updatedOrder.focusSyncStatus = 'FAILED';
                            updatedOrder.focusSyncResponse = focusResult.focus8Response;
                        }
                        await updatedOrder.save();
                    })
                    .catch(async (focusError) => {
                        logger.error('Focus8 Push Failed for Order ' + orderId, focusError);
                        updatedOrder.focusSyncStatus = 'FAILED';
                        updatedOrder.focusSyncResponse = focusError.response?.data || { message: focusError.message };
                        await updatedOrder.save();
                    });
            } else {
                logger.error('Dealer not found for order ', { orderId });
            }
        }

        return res.status(200).json({
            success: true,
            message: `Order successfully ${isVerified === 1 ? 'verified' : 'rejected'}.`,
            order: updatedOrder
        });

    } catch (error) {
        logger.error('Error updating order status: ', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating order status',
            error: error.message
        });
    }
};
