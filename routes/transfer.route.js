const express = require('express');
const router = express.Router();
const transferController = require('../controllers/transferController')
const passport = require("passport");

router.use(passport.authenticate('jwt', { session: false }));

router.post('/toDealer', async (req, res) => {
    transferController.transferPoints(req, result => {
        res.status(result.status).json(result);
    })
})

module.exports = router;