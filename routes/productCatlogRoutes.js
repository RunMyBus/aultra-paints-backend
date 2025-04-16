const express = require('express');
const router = express.Router();
const passport = require("passport");
const productCatlogController = require('../controllers/productCatlogController');
const multer = require('multer');
const upload = multer({
    limits: { fieldSize: 4 * 1024 * 1024 }, // Maximum size of a single form field (2 MB)
});

router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', upload.none(), productCatlogController.createProductCatlog);

router.get('/', productCatlogController.getProductCatlogs);

router.post('/search', productCatlogController.searchProductCatlog);

router.put('/update/:id', upload.none(), productCatlogController.updateProductCatlog);

router.delete('/delete/:id', productCatlogController.deleteProductCatlog);

module.exports = router;
