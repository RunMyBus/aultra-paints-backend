const logger = require('../utils/logger');

// Guard: only the listed account types may proceed. Use AFTER passport JWT auth.
// Example: router.post('/add', requireRole('SuperUser'), handler)
function requireRole(...allowed) {
    const roles = allowed.flat();
    return function requireRoleMiddleware(req, res, next) {
        const user = req.user;
        if (!user || !user.accountType) {
            return res.status(401).json({ status: 401, message: 'Unauthenticated' });
        }
        if (!roles.includes(user.accountType)) {
            logger.warn('Unauthorized access attempt', {
                userId: user._id,
                accountType: user.accountType,
                method: req.method,
                path: req.originalUrl,
                allowed: roles,
            });
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }
        return next();
    };
}

// Commonly-used role groups.
const ADMIN = ['SuperUser'];
const STAFF = ['SuperUser', 'SalesExecutive', 'ProductionManager'];
const ORDER_CREATORS = ['SuperUser', 'SalesExecutive', 'Dealer'];
const ORDER_EDITORS = ['SuperUser', 'ProductionManager'];

module.exports = {
    requireRole,
    ADMIN,
    STAFF,
    ORDER_CREATORS,
    ORDER_EDITORS,
};
