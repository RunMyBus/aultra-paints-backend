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
const { pushOrderToFocus8, getSOMobileAppOrders, getDCInvoiceForOrder, getProductMaster } = require("../services/focus8Order.service");


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

// Perform a Focus 8 push asynchronously and persist the outcome via updateOne.
// Failures are logged with enough context that ops can find and retry them.
async function runFocusSync(orderDocId, orderId, order, dealer, { entityId, warehouseId, branchId, narration } = {}) {
    try {
        const result = await pushOrderToFocus8(order, dealer, { entityId, warehouseId, branchId, narration });
        const update = result.success
            ? {
                focusSyncStatus: 'SUCCESS',
                focusOrderId: result.voucherNo,
                focusSyncResponse: result.focus8Response,
            }
            : {
                focusSyncStatus: 'FAILED',
                focusSyncResponse: result.focus8Response,
            };
        await orderModel.updateOne({ _id: orderDocId }, { $set: update });
        if (!result.success) {
            logger.warn('Focus 8 sync failed', { orderId, focus8Response: result.focus8Response });
        }
    } catch (focusError) {
        logger.error('Focus 8 push threw', { orderId, error: focusError.message });
        await orderModel.updateOne(
            { _id: orderDocId },
            { $set: {
                focusSyncStatus: 'FAILED',
                focusSyncResponse: focusError.response?.data || { message: focusError.message },
            } }
        );
    }
}

// Admin retry for stuck orders.
exports.retryFocusSync = async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

        const order = await orderModel.findOne({ orderId });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (order.focusSyncStatus === 'SUCCESS') {
            return res.status(400).json({ success: false, message: 'Order already synced to Focus 8' });
        }

        const dealer = order.dealerId
            ? await userModel.findById(order.dealerId)
            : await userModel.findById(order.createdBy);
        if (!dealer) {
            return res.status(404).json({ success: false, message: 'Dealer not found for order' });
        }

        // Mark pending, kick off, return immediately.
        await orderModel.updateOne({ _id: order._id }, { $set: { focusSyncStatus: 'PENDING' } });
        runFocusSync(order._id, order.orderId, order, dealer, {
            entityId: order.entityId,
            warehouseId: order.warehouseId,
            branchId: order.branchId,
            narration: order.narration
        });
        return res.status(200).json({ success: true, message: 'Retry initiated', orderId });
    } catch (error) {
        logger.error('Focus 8 retry failed', { error: error.message });
        return res.status(500).json({ success: false, message: error.message });
    }
};

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

        const { items, totalPrice, entityId, warehouseId, branchId, narration } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No items provided for order.' });
        }
        if (req.user.accountType === 'SalesExecutive') {
            if (!entityId) return res.status(400).json({ success: false, message: 'Entity is required.' });
            if (!warehouseId) return res.status(400).json({ success: false, message: 'Warehouse is required.' });
            if (!branchId) return res.status(400).json({ success: false, message: 'Branch is required.' });
        }

        // Fetch every referenced offer so we can (a) enrich Focus 8 IDs and
        // (b) re-derive prices server-side — never trust client-supplied prices.
        const productIds = items.map(i => i._id).filter(Boolean);
        const offers = await productOffersModel.find({ _id: { $in: productIds } })
            .select('focusProductId focusUnitId focusProductMapping productOfferDescription price offerAvailable');
        const offerMap = new Map(offers.map(o => [o._id.toString(), o]));

        for (const item of items) {
            if (!item._id || !offerMap.has(item._id.toString())) {
                return res.status(400).json({
                    success: false,
                    message: `Unknown product offer: ${item._id || item.productOfferDescription}`
                });
            }
            const offer = offerMap.get(item._id.toString());

            const qty = Number(item.quantity);
            if (!Number.isInteger(qty) || qty <= 0 || qty > 10000) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid quantity for ${offer.productOfferDescription}`
                });
            }
            item.quantity = qty;

            // Resolve authoritative unit price by volume (falls back to any tier if volume absent).
            const priceTier = (offer.price || []).find(p => p.volume === item.volume) || (offer.price || [])[0];
            if (!priceTier || typeof priceTier.price !== 'number') {
                return res.status(400).json({
                    success: false,
                    message: `No price configured for ${offer.productOfferDescription} @ ${item.volume}`
                });
            }
            // Overwrite any client-supplied price with the server-side value.
            item.productPrice = priceTier.price;

            // Resolve Focus 8 IDs.
            if (!item.focusProductId || !item.focusUnitId) {
                if (offer.focusProductMapping && offer.focusProductMapping.length > 0 && item.volume) {
                    const volumeMapping = offer.focusProductMapping.find(m => m.volume === item.volume);
                    if (volumeMapping) {
                        item.focusProductId = item.focusProductId || volumeMapping.focusProductId;
                        item.focusUnitId = item.focusUnitId || volumeMapping.focusUnitId || 1;
                    } else {
                        logger.warn(`ORDER :: No volume mapping found for volume ${item.volume} in product ${item._id}`);
                        item.focusProductId = item.focusProductId || offer.focusProductId;
                        item.focusUnitId = item.focusUnitId || offer.focusUnitId;
                    }
                } else {
                    item.focusProductId = item.focusProductId || offer.focusProductId;
                    item.focusUnitId = item.focusUnitId || offer.focusUnitId || 1;
                }
            }
        }

        // Re-compute total from authoritative prices; reject if client disagrees.
        let calculatedTotalPrice = 0;
        items.forEach(item => {
            calculatedTotalPrice += (item.productPrice || 0) * (item.quantity || 1);
        });
        calculatedTotalPrice = Number(calculatedTotalPrice.toFixed(2));
        if (totalPrice !== undefined && Number(Number(totalPrice).toFixed(2)) !== calculatedTotalPrice) {
            return res.status(400).json({
                success: false,
                message: 'Price mismatch: totalPrice does not match the server-computed total.'
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
            isVerified: isVerified,
            statusHistory: [{ status: orderStatus, changedAt: new Date() }],
            entityId,
            warehouseId,
            branchId,
            ...(narration ? { narration } : {})
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

        // Kick off Focus 8 sync but return the API response immediately with
        // focusSyncStatus: PENDING so the client can poll. Persist via updateOne
        // (not order.save) to avoid racing the in-memory document.
        if (req.user.accountType === 'SalesExecutive') {
            runFocusSync(order._id, orderId, order, orderCreatedForDetails, { entityId, warehouseId, branchId, narration });
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
                isVerified: isVerified,
                focusOrderId: null,
                focusDCInvoiceId: []
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
        const { page, limit, status, dealerCode, salesExecutiveMobile } = req.body;

        const ALLOWED_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'DISPATCHED', 'IN-PARCEL'];
        if (status !== undefined && status !== null && status !== '') {
            if (!ALLOWED_STATUSES.includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status' });
            }
        }

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

        // Resolve dealerCode (server-side) to a User._id. Dealers ignore this
        // filter — they always see only their own orders. For SuperUser/SE,
        // an unknown code short-circuits to an empty page.
        let dealerIdFromCode = null;
        if (dealerCode && typeof dealerCode === 'string' && dealerCode.trim()) {
            const trimmed = dealerCode.trim();
            if (accountType === 'Dealer') {
                // Dealers always see only their own orders; ignore filter silently.
            } else {
                const dealerDoc = await userModel.findOne(
                    { dealerCode: trimmed, accountType: 'Dealer' },
                    { _id: 1 }
                ).lean();
                if (!dealerDoc) {
                    return res.status(200).json({
                        success: true,
                        orders: [],
                        total: 0,
                        pages: 0,
                        currentPage: page,
                    });
                }
                dealerIdFromCode = dealerDoc._id;
            }
        }

        let query = {};
        let populateOptions = {
            path: 'createdBy',
            select: 'name mobile accountType dealerCode'
        };
        let orders;
        let totalOrders;

        // If SuperUser, fetch all orders with user details
        if (accountType === 'SuperUser') {
            if (status) {
                query.status = status;
            }
            if (dealerIdFromCode) {
                query.$or = [
                    { createdBy: dealerIdFromCode },
                    { dealerId: dealerIdFromCode },
                ];
            } else if (salesExecutiveMobile && typeof salesExecutiveMobile === 'string' && salesExecutiveMobile.trim()) {
                const seDealers = await userModel.find(
                    { salesExecutive: salesExecutiveMobile.trim(), accountType: 'Dealer', status: 'active' },
                    '_id'
                ).lean();
                const seDealerIds = seDealers.map(d => d._id);
                if (seDealerIds.length === 0) {
                    return res.status(200).json({ success: true, orders: [], total: 0, pages: 0, currentPage: page });
                }
                query.$or = [
                    { createdBy: { $in: seDealerIds } },
                    { dealerId: { $in: seDealerIds } },
                ];
            }
            totalOrders = await orderModel.countDocuments(query);
            orders = await orderModel
                .find(query)
                .populate(populateOptions)
                .populate({ path: 'dealerId', select: 'name dealerCode mobile' })
                .sort({ createdAt: -1 }) // Latest orders first
                .skip((page - 1) * limit)
                .limit(limit)
                .lean();
        } // If SalesExecutive, fetch orders from mapped dealers (including junior SEs' dealers)
        else if (accountType === 'SalesExecutive') {
            // Include dealers mapped to this SE and to any junior SEs reporting to them.
            const juniorSEs = await userModel.find(
                { parentSalesExecutive: user.mobile, accountType: 'SalesExecutive', status: 'active' },
                'mobile'
            ).lean();
            const seeMobiles = [user.mobile, ...juniorSEs.map(j => j.mobile)];
            // If a specific SE mobile is requested and it's within the allowed set, narrow the scope.
            let filteredMobiles = seeMobiles;
            if (salesExecutiveMobile && typeof salesExecutiveMobile === 'string' && seeMobiles.includes(salesExecutiveMobile.trim())) {
                filteredMobiles = [salesExecutiveMobile.trim()];
            }
            const mappedDealers = await userModel.find(
                {
                    salesExecutive: { $in: filteredMobiles },
                    accountType: 'Dealer',
                    status: 'active'
                },
                '_id'
            ).lean();

            const dealerIds = mappedDealers.map(dealer => dealer._id);
            // If a dealerCode was supplied, intersect with the SE's mapped dealers.
            // If the typed code resolves to a dealer outside the SE's set, the
            // intersection is empty — short-circuit to an empty page rather than
            // issuing a $in: [] query.
            let effectiveDealerIds = dealerIds;
            if (dealerIdFromCode) {
                const typedId = dealerIdFromCode.toString();
                effectiveDealerIds = dealerIds.filter(id => id.toString() === typedId);
                if (effectiveDealerIds.length === 0) {
                    return res.status(200).json({
                        success: true,
                        orders: [],
                        total: 0,
                        pages: 0,
                        currentPage: page,
                    });
                }
            }
            query = { $or: [{ createdBy: { $in: effectiveDealerIds } }, { dealerId: { $in: effectiveDealerIds } }] };
            if (status) {
                query.status = status;
            }
            totalOrders = await orderModel.countDocuments(query);
            orders = await orderModel
                .find(query)
                .populate({
                    path: 'createdBy',
                    select: 'name dealerCode mobile accountType'
                })
                .populate({
                    path: 'dealerId',
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
            if (status) {
                query.status = status;
            }
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

        // Enrich orders with Focus8 SO data (last 6 months)
        let focusRowsByOrderId = {};
        try {
            const soRows = await getSOMobileAppOrders();
            soRows.forEach(row => {
                const key = row['MobileAppOrderId'];
                if (!key) return;
                if (!focusRowsByOrderId[key]) focusRowsByOrderId[key] = [];
                focusRowsByOrderId[key].push(row);
            });
        } catch (err) {
            logger.warn('FOCUS8 :: Failed to fetch udv_SOMobileApp for order list enrichment', { message: err.message });
        }

        const enrichedOrders = orders.map(order => ({
            ...order,
            focusData: focusRowsByOrderId[order.orderId] || []
        }));

        return res.status(200).json({
            success: true,
            orders: enrichedOrders,
            total: totalOrders,
            pages: totalPages,
            currentPage: page
        });
    } catch (error) {
        logger.error('Error fetching orders ', error);
        return res.status(400).json({ success: false, message: error.message });
    }
};

exports.getOrderDetails = async (req, res) => {
    try {
        const user = req.user;
        const { orderId } = req.params;

        const order = await orderModel
            .findOne({ orderId })
            .populate({ path: 'createdBy', select: 'name mobile accountType dealerCode' })
            .populate({ path: 'dealerId', select: 'name dealerCode mobile' })
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Access control
        if (user.accountType === 'Dealer') {
            const ownerId = order.dealerId?._id?.toString() || order.createdBy?._id?.toString();
            if (ownerId !== user._id.toString()) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        } else if (user.accountType === 'SalesExecutive') {
            const mappedDealers = await userModel.find(
                { salesExecutive: user.mobile, accountType: 'Dealer', status: 'active' },
                '_id'
            ).lean();
            const dealerIds = mappedDealers.map(d => d._id.toString());
            const createdById = order.createdBy?._id?.toString();
            const dealerId = order.dealerId?._id?.toString();
            if (!dealerIds.includes(createdById) && !dealerIds.includes(dealerId)) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }

        if (order.focusSyncStatus === 'SUCCESS' && order.focusOrderId) {
            try {
                const [dcRows, productMaster] = await Promise.all([
                    getDCInvoiceForOrder(order.orderId, order.createdAt),
                    getProductMaster()
                ]);

                // Build focusProductId -> Item Name map
                const idToName = {};
                productMaster.forEach(p => { idToName[p.iMasterId] = p.sName; });

                // Sum dispatched qty per Item Name from DC invoice
                const dcQtyByName = {};
                dcRows.forEach(row => {
                    const name = row['Item Name'];
                    if (!name) return;
                    dcQtyByName[name] = (dcQtyByName[name] || 0) + Number(row['Quantity'] || 0);
                });

                // Compare each order item's ordered qty vs dispatched qty
                let fullyDispatched = 0;
                let partiallyDispatched = 0;

                const itemsWithStatus = order.items.map(item => {
                    const itemName = idToName[item.focusProductId];
                    const dcQty = itemName ? (dcQtyByName[itemName] || 0) : 0;
                    let itemStatus = order.status;
                    if (dcQty >= item.quantity) {
                        itemStatus = 'DISPATCHED';
                        fullyDispatched++;
                    } else if (dcQty > 0) {
                        itemStatus = 'IN-PARCEL';
                        partiallyDispatched++;
                    }
                    return { ...item, dispatchStatus: itemStatus, dispatchedQty: dcQty };
                });

                order.items = itemsWithStatus;

                let derivedStatus = order.status;
                if (fullyDispatched === itemsWithStatus.length) {
                    derivedStatus = 'DISPATCHED';
                } else if (fullyDispatched > 0 || partiallyDispatched > 0) {
                    derivedStatus = 'IN-PARCEL';
                }

                // Extract unique DC invoice IDs from fetched rows
                const dcInvoiceIds = [...new Set(dcRows.map(r => r['DocNo']).filter(Boolean))];
                const existingIds = (order.focusDCInvoiceId || []).slice().sort().join(',');
                const idsChanged = dcInvoiceIds.slice().sort().join(',') !== existingIds;
                order.focusDCInvoiceId = dcInvoiceIds;

                // Persist status and/or DC invoice IDs if anything changed
                if (derivedStatus !== order.status || idsChanged) {
                    const updateDoc = { focusDCInvoiceId: dcInvoiceIds };
                    if (derivedStatus !== order.status) {
                        updateDoc.status = derivedStatus;
                        updateDoc.$push = { statusHistory: { status: derivedStatus, changedAt: new Date() } };
                        order.status = derivedStatus;
                    }
                    await orderModel.findOneAndUpdate({ orderId }, updateDoc, { new: false });
                }
            } catch (err) {
                logger.warn(`FOCUS8 :: Failed to fetch DC invoice for order ${orderId}`, { message: err.message });
            }
        }

        // Enrich with Focus8 SO data (same as /orders list)
        try {
            const soRows = await getSOMobileAppOrders();
            order.focusData = soRows.filter(row => row['MobileAppOrderId'] === order.orderId);
        } catch (err) {
            logger.warn(`FOCUS8 :: Failed to fetch SO data for order ${orderId}`, { message: err.message });
            order.focusData = [];
        }

        return res.status(200).json({ success: true, order });
    } catch (error) {
        logger.error('Error fetching order details', error);
        return res.status(400).json({ success: false, message: error.message });
    }
};

exports.getOrderDealers = async (req, res) => {
    try {
        const { accountType, mobile } = req.user;
        if (!['SuperUser', 'SalesExecutive'].includes(accountType)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const filter = { accountType: 'Dealer', status: 'active' };
        if (accountType === 'SalesExecutive') {
            const juniorSEs = await userModel.find(
                { parentSalesExecutive: mobile, accountType: 'SalesExecutive', status: 'active' },
                'mobile'
            ).lean();
            const seeMobiles = [mobile, ...juniorSEs.map(j => j.mobile)];
            filter.salesExecutive = { $in: seeMobiles };
        }
        const dealers = await userModel
            .find(filter, { _id: 1, dealerCode: 1, name: 1 })
            .sort({ dealerCode: 1 })
            .lean();
        return res.status(200).json({ success: true, dealers });
    } catch (error) {
        logger.error('Error fetching order dealers', error);
        return res.status(500).json({ success: false, message: 'Error fetching dealers' });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderId, isVerified, entityId, warehouseId, branchId, narration } = req.body;
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
                isRejected: false,
                $push: { statusHistory: { status: 'VERIFIED', changedAt: new Date() } }
            };
        } else if (isVerified === 0) {
            updateData = {
                status: 'REJECTED',
                isVerified: false,
                isRejected: true,
                $push: { statusHistory: { status: 'REJECTED', changedAt: new Date() } }
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

        // If order is verified, push to Focus 8 via the safe async helper.
        if (isVerified === 1) {
            const dealer = await userModel.findById(order.createdBy);
            if (dealer) {
                runFocusSync(updatedOrder._id, orderId, updatedOrder, dealer, {
                    entityId: entityId || order.entityId,
                    warehouseId: warehouseId || order.warehouseId,
                    branchId: branchId || order.branchId,
                    narration: narration || order.narration
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
