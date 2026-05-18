const express = require('express');
const passport = require('passport');
const router = express.Router();
const dealsController = require('../controllers/deals.controller');
const { requireRole, ADMIN } = require('../middleware/authorize');

// All deals routes require a valid JWT.
router.use(passport.authenticate('jwt', { session: false }));

// Mobile/dealer-facing endpoint — any authenticated user can call it; the
// controller filters server-side by req.user.productCategories.
router.get('/active', dealsController.getActiveDealsForUser);

// Admin-only management routes.
router.get('/', requireRole(ADMIN), dealsController.getDeals);
router.post('/', requireRole(ADMIN), dealsController.createDeal);
router.get('/:id', requireRole(ADMIN), dealsController.getDealById);
router.put('/:id', requireRole(ADMIN), dealsController.updateDeal);
router.delete('/:id', requireRole(ADMIN), dealsController.deleteDeal);

module.exports = router;
