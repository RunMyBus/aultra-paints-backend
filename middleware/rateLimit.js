const logger = require('../utils/logger');

// Simple in-process rate limiter keyed on an arbitrary extractor.
// Good enough for a single-node deployment; swap for a Redis-backed
// limiter when the API scales horizontally across PM2 workers.
function rateLimit({ windowMs, max, keyFn, message }) {
    const hits = new Map(); // key -> { count, resetAt }

    // Periodic cleanup so the map doesn't grow unbounded.
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) {
            if (v.resetAt <= now) hits.delete(k);
        }
    }, Math.max(windowMs, 60_000)).unref();

    return function rateLimiter(req, res, next) {
        const key = keyFn(req);
        if (!key) return next();
        const now = Date.now();
        const entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        entry.count += 1;
        if (entry.count > max) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            logger.warn('Rate limit exceeded', { key, path: req.originalUrl, count: entry.count });
            return res.status(429).json({
                status: 429,
                message: message || 'Too many requests. Please try again later.',
                retryAfter,
            });
        }
        next();
    };
}

// Key extractors.
const byMobileInBody = (req) => {
    const m = req.body && req.body.mobile;
    return m ? `mobile:${String(m).replace(/\D/g, '').slice(-10)}` : null;
};
const byIp = (req) => `ip:${req.ip || req.connection?.remoteAddress || 'unknown'}`;
const byMobileOrIp = (req) => byMobileInBody(req) || byIp(req);

module.exports = {
    rateLimit,
    byMobileInBody,
    byIp,
    byMobileOrIp,
};
