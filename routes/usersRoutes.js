const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController')
const passport = require("passport");
router.use(passport.authenticate('jwt', {session: false}));

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

router.put('/toggle-status/:id', (req, res) => {
	const {id} = req.params;
	userController.toggleUserStatus(id, res);
});

router.delete('/:id', async (req, res) => {
	userController.deleteUser(req.params, result => {
		res.status(result.status).json(result)
	})
});

// router.post('/userDashboard', async (req, res) => {
router.post('/userDashboard', async (req, res) => {
	userController.getUserDashboard(req.body, result => {
		res.status(result.status).json(result);
	})
});

router.post('/getParentDealerCodeUser', async (req, res) => {
	userController.getParentDealerCodeUser(req.body, result => {
		res.status(result.status).json(result);
	})
});

router.post('/verifyOtpUpdateUser', async (req, res) => {
	userController.verifyOtpUpdateUser(req.body, result => {
		res.status(result.status).json(result);
	})
});

router.get('userAccountSuspended/:mobile', async (req, res) => {
	userController.accountSuspended(req.params, result => {
		res.status(result.status).json(result)
	})
});

router.post('/getMyPainters', async (req, res) => {
	userController.getMyPainters(req, result => {
		res.status(result.status).json(result);
	})
});

router.get('/getUserDealer/:dealerCode', async (req, res) => {
	userController.getUserDealer(req.params.dealerCode, result => {
		res.status(result.status).json(result);
	})
});

router.post('/unverified-users', async (req, res) => {
	userController.getUnverifiedUsers(req.body, result => {
		res.status(result.status).json(result);
	});
});

router.post('/getDealers', async (req, res) => {
	userController.getDealers(req.body, result => {
		res.status(result.status).json(result);
	})
});


router.get('/sales-executives', async (req, res) => {
    userController.getAllSalesExecutives(req, res);  
});



module.exports = router;
