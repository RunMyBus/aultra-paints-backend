// Must be set before requiring authController — module-level constants are captured
// at require() time, so setting them after is too late.
process.env.ACTIVATE_CASHFREE_PG = 'true';
process.env.ACTIVATE_BULKPE_PG = 'false';
process.env.CASH_REDEEM_ELIGIBLE_ACCOUNT_TYPES = 'Dealer';
global.config = process.env;

const authController = require('../../controllers/authController');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const cashFreePaymentService = require('../../services/cashFreePaymentService');
const { getDealerAccountId } = require('../../services/focus8Order.service');

// Mock the dependencies
jest.mock('../../models/User');
jest.mock('../../models/Transaction');
jest.mock('../../models/TransactionLedger');
jest.mock('../../services/cashFreePaymentService');
jest.mock('../../services/bulkPePaymentService');
jest.mock('../../services/focus8Order.service', () => ({ getDealerAccountId: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const transactionLedger = require('../../models/TransactionLedger');

const DEALER_USER = { _id: 'user123', name: 'Test Dealer', mobile: '1234567890', cash: 200, accountType: 'Dealer', dealerCode: 'D001' };
const MOCK_TRANSACTION = { _id: 'txn123', UDID: 'test-qr-123', value: 100, couponCode: 'COUP01', cashRedeemedBy: undefined };

describe('redeemCash', () => {
    const next = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ─── Dealer eligibility guard ────────────────────────────────────────────

    test('should return 403 if user not found in DB', async () => {
        const req = { body: { mobile: '9999999999', upi: 'test@upi' }, params: { qrCodeID: 'test-qr-123' } };

        User.findOne.mockResolvedValue(null);

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 403, message: 'Only registered users can redeem. User not found.' });
        expect(getDealerAccountId).not.toHaveBeenCalled();
    });

    test('should return 403 if user is not a Dealer', async () => {
        const req = { body: { mobile: '1234567890', upi: 'test@upi' }, params: { qrCodeID: 'test-qr-123' } };

        User.findOne.mockResolvedValue({ ...DEALER_USER, accountType: 'Painter' });

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 403, message: expect.stringContaining('Only') });
        expect(getDealerAccountId).not.toHaveBeenCalled();
    });

    test('should return 403 if dealer has no dealerCode', async () => {
        const req = { body: { mobile: '1234567890', upi: 'test@upi' }, params: { qrCodeID: 'test-qr-123' } };

        User.findOne.mockResolvedValue({ ...DEALER_USER, dealerCode: undefined });

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 403, message: 'Dealer code not set. Contact support.' });
        expect(getDealerAccountId).not.toHaveBeenCalled();
    });

    test('should return 403 if dealer not found in Focus8', async () => {
        const req = { body: { mobile: '1234567890', upi: 'test@upi' }, params: { qrCodeID: 'test-qr-123' } };

        User.findOne.mockResolvedValue(DEALER_USER);
        getDealerAccountId.mockResolvedValue(null);

        await authController.redeemCash(req, next);

        expect(getDealerAccountId).toHaveBeenCalledWith('D001');
        expect(next).toHaveBeenCalledWith({ status: 403, message: 'Dealer not found in Focus8. Contact support.' });
    });

    // ─── Happy path & downstream errors ─────────────────────────────────────

    test('should successfully redeem cash for a valid Dealer', async () => {
        const req = {
            body: { mobile: '1234567890', upi: 'test@upi' },
            params: { qrCodeID: 'test-qr-123' }
        };

        const updatedTransaction = { ...MOCK_TRANSACTION, updatedBy: 'user123', cashRedeemedBy: '1234567890' };

        User.findOne.mockResolvedValue(DEALER_USER);
        getDealerAccountId.mockResolvedValue(42);
        Transaction.findOne.mockResolvedValue(MOCK_TRANSACTION);
        cashFreePaymentService.upiPayment.mockResolvedValue({ success: true });
        Transaction.findOneAndUpdate.mockResolvedValue(updatedTransaction);
        User.findOneAndUpdate.mockResolvedValue(DEALER_USER);
        transactionLedger.create.mockResolvedValue({});

        await authController.redeemCash(req, next);

        expect(getDealerAccountId).toHaveBeenCalledWith('D001');
        expect(Transaction.findOne).toHaveBeenCalledWith({ UDID: 'test-qr-123' });
        expect(cashFreePaymentService.upiPayment).toHaveBeenCalledWith('test@upi', '1234567890', 100);
        expect(Transaction.findOneAndUpdate).toHaveBeenCalledWith(
            { UDID: 'test-qr-123' },
            { $set: expect.objectContaining({ updatedBy: 'user123', cashRedeemedBy: '1234567890' }) },
            { new: true }
        );
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    });

    test('should return 404 if transaction not found', async () => {
        const req = {
            body: { mobile: '1234567890', upi: 'test@upi' },
            params: { qrCodeID: 'invalid-qr' }
        };

        User.findOne.mockResolvedValue(DEALER_USER);
        getDealerAccountId.mockResolvedValue(42);
        Transaction.findOne.mockResolvedValue(null);

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 404, message: 'Transaction not found for QR code: invalid-qr' });
    });

    test('should return 400 if coupon already redeemed', async () => {
        const req = {
            body: { mobile: '1234567890', upi: 'test@upi' },
            params: { qrCodeID: 'test-qr-123' }
        };

        User.findOne.mockResolvedValue(DEALER_USER);
        getDealerAccountId.mockResolvedValue(42);
        Transaction.findOne.mockResolvedValue({ ...MOCK_TRANSACTION, cashRedeemedBy: 'someone' });

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 400, message: 'Coupon already redeemed.' });
    });

    test('should return 400 if payment fails', async () => {
        const req = {
            body: { mobile: '1234567890', upi: 'test@upi' },
            params: { qrCodeID: 'test-qr-123' }
        };

        User.findOne.mockResolvedValue(DEALER_USER);
        getDealerAccountId.mockResolvedValue(42);
        Transaction.findOne.mockResolvedValue(MOCK_TRANSACTION);
        cashFreePaymentService.upiPayment.mockResolvedValue({ success: false, message: 'Payment failed' });

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({ status: 400, message: 'Payment failed' });
    });
});
