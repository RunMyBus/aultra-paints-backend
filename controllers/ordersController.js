const orderModel = require('../models/Order');
const logger = require('../utils/logger');
const config = process.env;
const InvoiceTemplate = require('../models/InvoiceTemplate');
const handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const productOffersModel = require("../models/productOffers.model");

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
        const { items, totalPrice } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No items provided for order.' });
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

        // GST Calculation (default 5%)
        const gstPercentage = parseFloat(config.GST_PERCENTAGE) || 5; // default to 5% if not set
        const gstPrice = +(calculatedTotalPrice * (gstPercentage / 100)).toFixed(2);
        const finalPrice = +(calculatedTotalPrice + gstPrice).toFixed(2);

        const orderId = await getNextOrderId();

        // Save order
        const order = new orderModel({
            orderId,
            items,
            totalPrice: calculatedTotalPrice,
            gstPrice,
            finalPrice,
            createdBy: userId || ''
        });

        await order.save();

        // const pdfBuffer = await generateInvoicePdf(order, req.user);

        return res.status(200).json({
            success: true,
            order: {
                items,
                totalPrice: calculatedTotalPrice,
                gstPrice,
                finalPrice,
                gstPercentage: parseFloat(config.GST_PERCENTAGE) || 5
            },
            // invoicePdfBase64: pdfBuffer.toString('base64')
        });
    } catch (error) {
        logger.error('Order creation failed ', error);
        return res.status(400).json({ success: false, message: error.message });
    }
};