const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController')

// Get all users
router.get('/all', async (req, res) => {
    userController.getAll(req.body, result => {
        res.status(result.status).json(result.data);
    })
});

router.post('/searchUser', async (req, res) => {
    userController.searchUser(req.body, result => {
        res.status(result.status).json(result);
    })
});

router.post('/add', async (req, res) => {
    userController.addUser(req.body, result => {
        res.status(result.status).json(result)
    })
});

router.get('/getUser/:id', async (req, res) => {
    userController.getUser(req.params, result => {
        res.status(result.status).json(result)
    })
});

router.put('/:id', async (req, res) => {
    userController.userUpdate(req.params.id, req.body, result => {
        res.status(result.status).json(result)
    })
});


router.delete('/:id', async (req, res) => {
    userController.deleteUser(req.params, result => {
        res.status(result.status).json(result)
    })
});

module.exports = router;
