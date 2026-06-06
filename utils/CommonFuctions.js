async function sanitize(input) {
    let sanitized = input.replace(/[^a-zA-Z0-9]/g, "_"); // Remove invalid characters
    sanitized = sanitized.replace(/\s+/g, "_"); // Replace spaces with underscores
    sanitized = sanitized.replace(/-/g, "_"); // Replace hyphens with underscores
    return sanitized.slice(0, 50); // Ensure max length of 50 characters
}

// Focus stores phone columns (sTelNo, SalesManPhNO) inconsistently: comma-joined
// numbers, spaces, hyphens, a leading +91/91 country code or a trunk '0'. Reduce
// to the bare 10-digit Indian mobile so dealer mobiles, sales-executive mobiles,
// and conflict checks all compare equal.
//
// A country/trunk prefix is stripped ONLY when the length implies one — stripping
// a leading "91" unconditionally would destroy valid mobiles in the 91xxxxxxxx
// series. Returns '' when the value isn't a clean 10-digit mobile (e.g. landlines
// with an STD code), so callers can detect and skip rather than store garbage.
function normalizePhone(raw) {
    if (!raw) return '';
    let digits = String(raw).split(',')[0].replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2); // +91 country code
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // STD trunk '0'
    return digits.length === 10 ? digits : '';
}

module.exports = { sanitize, normalizePhone };
