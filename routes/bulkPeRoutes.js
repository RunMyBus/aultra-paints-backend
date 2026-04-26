// BulkPe cash-redemption endpoints — DISABLED.
//
// Cash redemption (points → INR via BulkPe UPI payouts) was retired alongside
// the Cashfree path. All previously-mounted endpoints under `/bulkPe/*` now
// return HTTP 410 Gone with a stable JSON error payload. The full
// implementation is preserved in git history.

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
        `Disabled BulkPe endpoint hit: ${req.method} ${req.originalUrl}`,
        { ip: req.ip, userId: req.user && req.user._id },
    );
    return res.status(410).json(DISABLED_RESPONSE);
});

module.exports = router;
