const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole, ADMIN } = require('../middleware/authorize');
const productCategoryController = require('../controllers/productCategoryController');

router.use(passport.authenticate('jwt', { session: false }));

router.post('/', requireRole(ADMIN), productCategoryController.createProductCategory);
router.get('/all', productCategoryController.getProductCategories);
router.put('/:id', requireRole(ADMIN), productCategoryController.updateProductCategory);
router.delete('/:id', requireRole(ADMIN), productCategoryController.deleteProductCategory);

module.exports = router;
