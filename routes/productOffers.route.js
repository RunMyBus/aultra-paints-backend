const express = require('express');
const router = express.Router();
const productOffersController = require('../controllers/productOffers.controller');
const passport = require("passport");
const multer = require('multer');
const upload = multer();


router.use(passport.authenticate('jwt', { session: false }));

router.post('/create', upload.none(), productOffersController.createProductOffer);
router.post('/searchProductOffers', productOffersController.searchProductOffers);
router.get('/getProductOffers', productOffersController.getProductOffers);
router.get('/getProductOfferById:id', productOffersController.getProductOfferById);
// router.put('/update:id', upload.none(), productOffersController.updateProductOffer);
router.put('/update/:id', upload.none(), async (req, res) => {
    productOffersController.updateProductOffer(req, result => {
        res.status(result.status).json(result)
    })
});
router.delete('/delete:id', productOffersController.deleteProductOffer);

module.exports = router;