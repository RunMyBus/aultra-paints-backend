// Must be set before requiring authController — module-level constants are captured
// at require() time, so setting them after is too late.
process.env.ACTIVATE_CASHFREE_PG = 'true';
process.env.ACTIVATE_BULKPE_PG = 'false';
process.env.CASH_REDEEM_ELIGIBLE_ACCOUNT_TYPES = 'Dealer';
global.config = process.env;

// Mock the dependencies
jest.mock('../../models/User');
jest.mock('../../models/Transaction');
jest.mock('../../models/TransactionLedger');
jest.mock('../../services/cashFreePaymentService');
jest.mock('../../services/bulkPePaymentService');
jest.mock('../../services/focus8Order.service', () => ({ getDealerAccountId: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const authController = require('../../controllers/authController');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const cashFreePaymentService = require('../../services/cashFreePaymentService');
const transactionLedger = require('../../models/TransactionLedger');

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Mobile must be a valid Indian 10-digit number starting 6-9 (isValidMobile check).
const VALID_MOBILE = '9876543210';
const VALID_UPI    = 'dealer@upi';
const QR           = 'test-qr-123';

const DEALER_USER = {
    _id: 'user123',
    name: 'Test Dealer',
    mobile: VALID_MOBILE,
    cash: 200,
    accountType: 'Dealer',
    dealerCode: 'D001',
};

// Transaction returned by the atomic findOneAndUpdate claim
const CLAIMED_TXN = { _id: 'txn123', UDID: QR, value: 100, couponCode: 'COUP01' };

// ─────────────────────────────────────────────────────────────────────────────
// redeemCash — updated to match the reworked controller
// Flow: validate mobile → validate UPI → findUser → atomic claim →
//       payment → (user exists) update user cash / (user null) create new user
// ─────────────────────────────────────────────────────────────────────────────
describe('redeemCash', () => {
    const next = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        // Default: atomic claim succeeds; override per test as needed.
        Transaction.findOneAndUpdate.mockResolvedValue(CLAIMED_TXN);
        Transaction.updateOne = jest.fn().mockResolvedValue({});
    });

    // ── Input validation ──────────────────────────────────────────────────────

    test('400 when mobile is not a valid Indian number', async () => {
        const req = { body: { mobile: '1234567890', upi: VALID_UPI }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);
        expect(next).toHaveBeenCalledWith({ status: 400, message: 'Invalid mobile.' });
    });

    test('400 when UPI ID has invalid format', async () => {
        const req = { body: { mobile: VALID_MOBILE, upi: 'not-a-valid-upi' }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);
        expect(next).toHaveBeenCalledWith({ status: 400, message: 'Invalid UPI ID.' });
    });

    // ── Transaction lookup ────────────────────────────────────────────────────

    test('404 when QR code has no matching transaction in DB', async () => {
        User.findOne.mockResolvedValue(DEALER_USER);
        Transaction.findOneAndUpdate.mockResolvedValue(null); // atomic claim fails
        Transaction.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue(null), // no existing doc either
        });

        const req = { body: { mobile: VALID_MOBILE, upi: VALID_UPI }, params: { qrCodeID: 'no-such-qr' } };
        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({
            status: 404,
            message: 'Transaction not found for QR code: no-such-qr',
        });
    });

    test('409 when coupon has already been claimed by another redemption', async () => {
        User.findOne.mockResolvedValue(DEALER_USER);
        Transaction.findOneAndUpdate.mockResolvedValue(null); // atomic claim fails
        Transaction.findOne.mockReturnValue({
            select: jest.fn().mockResolvedValue(CLAIMED_TXN), // existing doc found
        });

        const req = { body: { mobile: VALID_MOBILE, upi: VALID_UPI }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 409, message: 'Coupon already redeemed.' });
    });

    // ── Payment ───────────────────────────────────────────────────────────────

    test('400 when payment gateway returns success:false and releases the claim', async () => {
        User.findOne.mockResolvedValue(DEALER_USER);
        // atomic claim succeeds (set by beforeEach)
        cashFreePaymentService.upiPayment.mockResolvedValue({ success: false, message: 'Payment failed' });

        const req = { body: { mobile: VALID_MOBILE, upi: VALID_UPI }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);

        // Claim must be released
        expect(Transaction.updateOne).toHaveBeenCalledWith(
            { _id: CLAIMED_TXN._id },
            expect.objectContaining({ $unset: expect.any(Object) })
        );
        expect(next).toHaveBeenCalledWith({ status: 400, message: 'Payment failed' });
    });

    // ── Happy paths ───────────────────────────────────────────────────────────

    test('200 success — existing user: cash incremented, ledger written', async () => {
        const updatedTxn  = { ...CLAIMED_TXN, updatedBy: 'user123' };
        const updatedUser = { ...DEALER_USER, cash: 300 };

        User.findOne.mockResolvedValue(DEALER_USER);
        // Two findOneAndUpdate calls: (1) atomic claim already set, (2) set updatedBy
        Transaction.findOneAndUpdate
            .mockResolvedValueOnce(CLAIMED_TXN)   // claim
            .mockResolvedValueOnce(updatedTxn);    // update updatedBy
        cashFreePaymentService.upiPayment.mockResolvedValue({ success: true });
        User.findOneAndUpdate.mockResolvedValue(updatedUser);
        transactionLedger.create.mockResolvedValue({});

        const req = { body: { mobile: VALID_MOBILE, upi: VALID_UPI }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);

        expect(cashFreePaymentService.upiPayment).toHaveBeenCalledWith(VALID_UPI, VALID_MOBILE, 100);
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: updatedTxn.updatedBy },
            expect.objectContaining({ $inc: { cash: 100 } }),
            { new: true }
        );
        expect(transactionLedger.create).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    });

    test('200 success — unregistered mobile: new User document created', async () => {
        const savedUser = { _id: 'newuser1', mobile: VALID_MOBILE, cash: 100, name: VALID_MOBILE };
        const updatedTxn = { ...CLAIMED_TXN, updatedBy: 'newuser1' };

        User.findOne.mockResolvedValue(null); // user not in DB
        Transaction.findOneAndUpdate
            .mockResolvedValueOnce(CLAIMED_TXN)  // atomic claim
            .mockResolvedValueOnce(updatedTxn);  // update after new user saved
        cashFreePaymentService.upiPayment.mockResolvedValue({ success: true });
        User.mockImplementation(() => ({ save: jest.fn().mockResolvedValue(savedUser) }));
        transactionLedger.create.mockResolvedValue({});

        const req = { body: { mobile: VALID_MOBILE, upi: VALID_UPI }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    });

    // ── Unexpected errors ─────────────────────────────────────────────────────

    test('500 on unexpected DB error', async () => {
        User.findOne.mockRejectedValue(new Error('Connection lost'));

        const req = { body: { mobile: VALID_MOBILE, upi: VALID_UPI }, params: { qrCodeID: QR } };
        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 500, message: 'Connection lost' });
    });
});
