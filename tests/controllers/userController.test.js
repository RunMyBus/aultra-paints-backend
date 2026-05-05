// ─────────────────────────────────────────────────────────────────────────────
// Module-level globals required by userController before any exports run.
// Must be set before require() — Jest hoists jest.mock() calls but NOT plain
// statements, so this assignment executes at the right time.
// ─────────────────────────────────────────────────────────────────────────────
global.config = process.env;

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — declared before any require() so Jest hoisting applies
// ─────────────────────────────────────────────────────────────────────────────
jest.mock('../../models/User');
jest.mock('../../models/Transaction');
jest.mock('../../models/redeemedUser.model');
jest.mock('../../models/UserLoginSMS');
jest.mock('../../services/user.service', () => ({
    validateAndCreateOTP: jest.fn(),
}));
jest.mock('../../services/focus8Order.service', () => ({
    getDealerFinancialData: jest.fn(),
}));
jest.mock('axios');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

const mongoose = require('mongoose');
const userModel = require('../../models/User');
const { getAllDealers, userUpdate } = require('../../controllers/userController');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// getAllDealers
// ─────────────────────────────────────────────────────────────────────────────
describe('getAllDealers', () => {
    const MOCK_DEALERS = [
        {
            _id: new mongoose.Types.ObjectId(),
            name: 'Alpha Paints',
            mobile: '9876500001',
            dealerCode: 'D001',
            rewardPoints: 4500,
            cash: 200,
            legacyCash: 800,
        },
        {
            _id: new mongoose.Types.ObjectId(),
            name: 'Beta Paints',
            mobile: '9876500002',
            dealerCode: 'D002',
            rewardPoints: 1200,
            cash: 0,
            legacyCash: 300,
        },
    ];

    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {};
        res = makeRes();
    });

    // ── Happy path ────────────────────────────────────────────────────────────
    test('200 with status:success and dealer array on success', async () => {
        userModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(MOCK_DEALERS) });

        await getAllDealers(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const body = res.json.mock.calls[0][0];
        expect(body.status).toBe('success');
        expect(body.data).toHaveLength(2);
    });

    test('queries only active Dealers', async () => {
        userModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

        await getAllDealers(req, res);

        const queryArg = userModel.find.mock.calls[0][0];
        expect(queryArg.accountType).toBe('Dealer');
        expect(queryArg.status).toBe('active');
    });

    test('projection includes rewardPoints, cash, and legacyCash', async () => {
        userModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

        await getAllDealers(req, res);

        const projectionArg = userModel.find.mock.calls[0][1];
        expect(projectionArg).toMatchObject({
            name: 1,
            mobile: 1,
            dealerCode: 1,
            rewardPoints: 1,
            cash: 1,
            legacyCash: 1,
        });
    });

    test('results are sorted by name ascending', async () => {
        const sortMock = jest.fn().mockResolvedValue(MOCK_DEALERS);
        userModel.find.mockReturnValue({ sort: sortMock });

        await getAllDealers(req, res);

        expect(sortMock).toHaveBeenCalledWith({ name: 1 });
    });

    test('each dealer record includes legacyCash (migration field present)', async () => {
        userModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(MOCK_DEALERS) });

        await getAllDealers(req, res);

        const body = res.json.mock.calls[0][0];
        body.data.forEach(dealer => {
            expect(dealer).toHaveProperty('legacyCash');
        });
    });

    // ── Error path ────────────────────────────────────────────────────────────
    test('500 with status:error on database failure', async () => {
        userModel.find.mockImplementation(() => {
            throw new Error('Connection lost');
        });

        await getAllDealers(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        const body = res.json.mock.calls[0][0];
        expect(body.status).toBe('error');
        expect(body.message).toBe('Error fetching dealers');
    });

    test('500 when sort() rejects', async () => {
        userModel.find.mockReturnValue({
            sort: jest.fn().mockRejectedValue(new Error('Sort failed')),
        });

        await getAllDealers(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].status).toBe('error');
    });

    test('returns empty array when no active dealers exist', async () => {
        userModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

        await getAllDealers(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const body = res.json.mock.calls[0][0];
        expect(body.data).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// userUpdate — productCategories whitelist
// ─────────────────────────────────────────────────────────────────────────────
describe('userUpdate — productCategories', () => {
    const USER_ID = new mongoose.Types.ObjectId().toString();
    const CAT_A   = new mongoose.Types.ObjectId();
    const CAT_B   = new mongoose.Types.ObjectId();

    // Minimal valid non-dealer body that passes all validation
    function dealerBody(overrides = {}) {
        return {
            mobile: '9876500001',
            name: 'Test Dealer',
            accountType: 'Dealer',
            primaryContactPerson: 'Contact',
            primaryContactPersonMobile: '9876500002',
            salesExecutive: '9876500003',
            dealerCode: 'D001',
            address: '123 Main St',
            productCategories: [CAT_A, CAT_B],
            ...overrides,
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        // No duplicate mobile, no duplicate dealer code
        userModel.findOne.mockResolvedValue(null);
        userModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    });

    test('productCategories is included in the $set payload sent to updateOne', async () => {
        const result = jest.fn();

        await userUpdate(USER_ID, dealerBody(), result);

        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
        const setPayload = userModel.updateOne.mock.calls[0][1].$set;
        expect(setPayload).toHaveProperty('productCategories');
        expect(setPayload.productCategories).toEqual([CAT_A, CAT_B]);
    });

    test('empty productCategories array is preserved in $set (not stripped)', async () => {
        const result = jest.fn();

        await userUpdate(USER_ID, dealerBody({ productCategories: [] }), result);

        const setPayload = userModel.updateOne.mock.calls[0][1].$set;
        expect(setPayload.productCategories).toEqual([]);
    });

    test('productCategories is NOT present in $set when omitted from body', async () => {
        const body = dealerBody();
        delete body.productCategories;
        const result = jest.fn();

        await userUpdate(USER_ID, body, result);

        const setPayload = userModel.updateOne.mock.calls[0][1].$set;
        expect(setPayload).not.toHaveProperty('productCategories');
    });

    test('updateOne is called with the correct user _id filter', async () => {
        const result = jest.fn();

        await userUpdate(USER_ID, dealerBody(), result);

        const filter = userModel.updateOne.mock.calls[0][0];
        expect(filter._id.toString()).toBe(USER_ID);
    });

    test('400 with errors array when mobile is missing', async () => {
        const body = dealerBody({ mobile: '' });
        const result = jest.fn();

        await userUpdate(USER_ID, body, result);

        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
        expect(result.mock.calls[0][0].errors).toContain('Enter mobile number');
        expect(userModel.updateOne).not.toHaveBeenCalled();
    });
});
