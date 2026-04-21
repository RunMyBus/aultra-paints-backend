const logger = require('../utils/logger');

const PROD = process.env.NODE_ENV === 'PROD' || process.env.NODE_ENV === 'production';

function required(name, { fallback } = {}) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
    if (PROD) {
        logger.error(`Missing required env var ${name} in production`);
        throw new Error(`Missing required env var ${name}`);
    }
    if (fallback !== undefined) {
        logger.warn(`Env var ${name} not set; using development fallback. Set it in production.`);
        return fallback;
    }
    throw new Error(`Missing env var ${name}`);
}

const JWT_SECRET = required('JWT_SECRET', { fallback: 'dev-only-jwt-secret-change-me' });
const SESSION_SECRET = required('SESSION_SECRET', { fallback: 'dev-only-session-secret-change-me' });

if (!PROD) {
    if (process.env.STATIC_MOBILE_NUMBER || process.env.STATIC_TEST_MOBILE_NUMBER || process.env.STATIC_OTP) {
        logger.warn('TEST AUTH ENABLED: STATIC_MOBILE_NUMBER / STATIC_OTP bypass is active. Must be disabled in production.');
    }
}

module.exports = {
    JWT_SECRET,
    SESSION_SECRET,
    IS_PROD: PROD,
};
