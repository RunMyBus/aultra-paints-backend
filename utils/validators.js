const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 10;

function escapeRegex(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRegex(input, { anchor = false, caseInsensitive = true } = {}) {
    const escaped = escapeRegex(input);
    const pattern = anchor ? `^${escaped}$` : escaped;
    return new RegExp(pattern, caseInsensitive ? 'i' : '');
}

// Clamp a client-supplied page-size to protect against DoS via large pages.
function clampLimit(raw, { max = MAX_PAGE_LIMIT, fallback = DEFAULT_PAGE_LIMIT } = {}) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
}

function clampPage(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return n;
}

// Indian mobile: 10 digits starting 6-9 (with optional +91 or 91 prefix stripped by caller).
const MOBILE_RE = /^[6-9]\d{9}$/;
function isValidMobile(mobile) {
    if (!mobile) return false;
    const s = String(mobile).replace(/\D/g, '').slice(-10);
    return MOBILE_RE.test(s);
}

// UPI VPA: handle@provider. Keep permissive on handle, stricter on provider.
const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9]{2,20}$/;
function isValidUpi(upi) {
    return typeof upi === 'string' && UPI_RE.test(upi.trim());
}

function isPositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

module.exports = {
    escapeRegex,
    safeRegex,
    clampLimit,
    clampPage,
    isValidMobile,
    isValidUpi,
    isPositiveNumber,
    isPositiveInteger,
    MAX_PAGE_LIMIT,
    DEFAULT_PAGE_LIMIT,
};
