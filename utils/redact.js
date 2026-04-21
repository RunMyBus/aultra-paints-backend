function maskMobile(mobile) {
    if (mobile == null) return mobile;
    const s = String(mobile);
    if (s.length < 6) return '******';
    return s.slice(0, 2) + '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-2);
}

function maskUpi(upi) {
    if (!upi || typeof upi !== 'string') return upi;
    const [name, bank] = upi.split('@');
    if (!bank) return '***';
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}***@${bank}`;
}

function maskOtp() {
    return '******';
}

function maskEmail(email) {
    if (!email || typeof email !== 'string') return email;
    const [name, domain] = email.split('@');
    if (!domain) return '***';
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}***@${domain}`;
}

function maskAccount(acc) {
    if (!acc) return acc;
    const s = String(acc);
    return s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4);
}

// Deep-clone a log metadata object and mask sensitive keys by name.
const SENSITIVE_KEYS = {
    mobile: maskMobile,
    phone: maskMobile,
    primaryContactPersonMobile: maskMobile,
    salesExecutive: maskMobile,
    upi: maskUpi,
    upiID: maskUpi,
    upiId: maskUpi,
    vpa: maskUpi,
    otp: maskOtp,
    OTP: maskOtp,
    email: maskEmail,
    accountNumber: maskAccount,
    token: () => '***redacted***',
    password: () => '***redacted***',
};

function redact(value, depth = 0) {
    if (depth > 6 || value == null) return value;
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    if (typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        const masker = SENSITIVE_KEYS[k];
        if (masker) out[k] = masker(v);
        else out[k] = redact(v, depth + 1);
    }
    return out;
}

module.exports = {
    maskMobile,
    maskUpi,
    maskOtp,
    maskEmail,
    maskAccount,
    redact,
};
