const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController')
const passport = require("passport");
const { requireRole, ADMIN, STAFF } = require('../middleware/authorize');
router.use(passport.authenticate('jwt', {session: false}));

// Get all users — admin only (full listing).
router.get('/all', requireRole(ADMIN), async (req, res) => {
	userController.getAll(req.body, result => {
		res.status(result.status).json(result.data);
	})
});

router.post('/searchUser', requireRole(STAFF), async (req, res) => {
	userController.searchUser(req.body, result => {
		res.status(result.status).json(result);
	})
});

router.post('/add', requireRole(STAFF), async (req, res) => {
	userController.addUser(req.body, result => {
		res.status(result.status).json(result)
	})
});

router.get('/getUser/:id', async (req, res) => {
	userController.getUser(req.params, result => {
		res.status(result.status).json(result)
	})
});

router.put('/:id', requireRole(STAFF), async (req, res) => {
	userController.userUpdate(req.params.id, req.body, result => {
		res.status(result.status).json(result)
	})
});

router.put('/toggle-status/:id', requireRole(ADMIN), (req, res) => {
	const {id} = req.params;
	userController.toggleUserStatus(id, res);
});

router.delete('/:id', requireRole(ADMIN), async (req, res) => {
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

router.post('/unverified-users', requireRole(ADMIN), async (req, res) => {
	userController.getUnverifiedUsers(req.body, result => {
		res.status(result.status).json(result);
	});
});

router.post('/getDealers', async (req, res) => {
	userController.getDealers(req, result => {
		res.status(result.status).json(result);
	})
});


router.get('/sales-executives', requireRole(ADMIN), async (req, res) => {
    userController.getAllSalesExecutives(req, res);
});

router.get('/dealers', requireRole(ADMIN), async (req, res) => {
    userController.getAllDealers(req, res);
});

router.post('/export', requireRole(ADMIN), userController.exportUsers);

router.get('/export-unverified', requireRole(ADMIN), userController.exportUnverifiedUsers);

module.exports = router;
