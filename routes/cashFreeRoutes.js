// Cashfree cash-redemption endpoints — DISABLED.
//
// Cash redemption (points → INR via Cashfree payouts) was retired.
// All previously-mounted endpoints under `/cashFree/*` now return HTTP 410 Gone
// with a stable JSON error payload. The full implementation is preserved in
// git history (and the controllers/services/model files remain on disk for
// transactional record-keeping queries) but no live entry-point exists.

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

const DISABLED_RESPONSE = Object.freeze({
    success: false,
    code: 'CASH_REDEMPTION_DISABLED',
    message: 'Cash redemption is no longer available. Please use points-to-dealer transfer instead.',
});

router.all('/*', (req, res) => {
    logger.warn(
        `Disabled Cashfree endpoint hit: ${req.method} ${req.originalUrl}`,
        { ip: req.ip, userId: req.user && req.user._id },
    );
    return res.status(410).json(DISABLED_RESPONSE);
});

module.exports = router;
