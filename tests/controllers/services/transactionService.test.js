// Must be set before requiring transactionService — redeemEligibleAccountTypes is
// captured as a module-level constant at require() time.
process.env.REDEEM_ELIGIBLE_ACCOUNT_TYPES = 'Dealer';
global.config = process.env;

const TransactionService = require('../../../services/transactionService');
const Transaction = require('../../../models/Transaction');
const User = require('../../../models/User');
const transactionLedger = require('../../../models/TransactionLedger');
const { getDealerAccountId } = require('../../../services/focus8Order.service');
const mongoose = require('mongoose');

jest.mock('../../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
}));
jest.mock('../../../models/Transaction');
jest.mock('../../../models/User');
jest.mock('../../../models/TransactionLedger');
jest.mock('../../../services/focus8Order.service', () => ({ getDealerAccountId: jest.fn() }));

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

const STATIC_USER_ID = new mongoose.Types.ObjectId();
const DEALER_ID = new mongoose.Types.ObjectId();

const STATIC_USER = { _id: STATIC_USER_ID, mobile: '9999999998' };
const DEALER_USER = { _id: DEALER_ID, mobile: '9000000001', accountType: 'Dealer', dealerCode: 'D001', rewardPoints: 500 };

// ─────────────────────────────────────────────────────────────────────────────

describe('TransactionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getTransactions with salesExecutiveMobile', () => {
        test('should return transactions for multiple dealers under sales executive', async () => {
            const mockBody = {
                page: 1,
                limit: 10,
                salesExecutiveMobile: '9876543210'
            };

            const mockDealers = [
                { _id: new mongoose.Types.ObjectId(), mobile: '1234567890', accountType: 'Dealer', salesExecutiveMobile: '9876543210' },
                { _id: new mongoose.Types.ObjectId(), mobile: '9876543211', accountType: 'Dealer', salesExecutiveMobile: '9876543210' }
            ];

            const mockTransactions = [
                { _id: new mongoose.Types.ObjectId(), pointsRedeemedBy: '1234567890', couponCode: '12345' },
                { _id: new mongoose.Types.ObjectId(), cashRedeemedBy: '9876543211', couponCode: '67890' }
            ];

            const mockAggregateResult = [
                { _id: new mongoose.Types.ObjectId(), batchId: new mongoose.Types.ObjectId(), couponCode: '12345', pointsRedeemedBy: '1234567890' },
                { _id: new mongoose.Types.ObjectId(), batchId: new mongoose.Types.ObjectId(), couponCode: '67890', cashRedeemedBy: '9876543211' }
            ];

            const mockTotalResult = [{ total: 2 }];

            User.findOne = jest.fn().mockResolvedValue(mockBody);
            User.find = jest.fn().mockResolvedValue(mockDealers);
            Transaction.find = jest.fn().mockResolvedValue(mockTransactions);
            Transaction.aggregate = jest.fn().mockImplementation((pipeline) => {
                if (pipeline.some(stage => stage.$count)) return Promise.resolve(mockTotalResult);
                return Promise.resolve(mockAggregateResult);
            });

            const result = await TransactionService.getTransactions({ salesExecutiveMobile: '9876543210', page: 1, limit: 10 });

            expect(result).toBeDefined();
            expect(result.total).toBe(2);
            expect(result.transactionsData).toEqual(mockAggregateResult);
            expect(User.findOne).toHaveBeenCalled();
            expect(User.find).toHaveBeenCalled();
            expect(Transaction.find).toHaveBeenCalled();
            expect(Transaction.aggregate).toHaveBeenCalled();
        });

        test('should throw error if sales executive does not exist', async () => {
            User.findOne = jest.fn().mockResolvedValue(null);

            await expect(TransactionService.getTransactions({ salesExecutiveMobile: '9876543210' }))
                .rejects.toThrow('Sales Executive with mobile number 9876543210 not found.');

            expect(User.findOne).toHaveBeenCalled();
        });

        test('should return error message when no dealers found under sales executive', async () => {
            User.findOne = jest.fn().mockResolvedValue({ page: 1, limit: 10, salesExecutiveMobile: '9876543210' });
            User.find = jest.fn().mockResolvedValue([]);

            await expect(TransactionService.getTransactions({ salesExecutiveMobile: '9876543210' }))
                .rejects.toThrow('No dealers found for Sales Executive with mobile number 9876543210.');

            expect(User.findOne).toHaveBeenCalled();
            expect(User.find).toHaveBeenCalled();
        });

        test('should handle database error when fetching dealers', async () => {
            User.findOne = jest.fn().mockRejectedValue(new Error('Database connection failed'));

            await expect(TransactionService.getTransactions({ salesExecutiveMobile: '9876543210' }))
                .rejects.toThrow('Database connection failed');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────

    describe('redeemCouponPoints', () => {
        const QR_URL = 'https://example.com/redeem?v=TEST-UDID-001';

        // stub extractValueFromUrl so we don't depend on URL parsing internals
        beforeEach(() => {
            jest.spyOn(TransactionService, 'extractValueFromUrl').mockResolvedValue('TEST-UDID-001');
        });

        function makeReq(userOverrides = {}) {
            return {
                user: { ...DEALER_USER, ...userOverrides },
                body: { qrCodeUrl: QR_URL }
            };
        }

        // ─── Dealer eligibility guard ─────────────────────────────────────

        test('should return 403 if user is not a Dealer', async () => {
            const req = makeReq({ accountType: 'Painter' });
            const res = makeRes();

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('Only') });
            expect(getDealerAccountId).not.toHaveBeenCalled();
        });

        test('should return 403 if dealer has no dealerCode', async () => {
            const req = makeReq({ dealerCode: undefined });
            const res = makeRes();

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Dealer code not set. Contact support.' });
            expect(getDealerAccountId).not.toHaveBeenCalled();
        });

        test('should return 403 if dealer not found in Focus8', async () => {
            const req = makeReq();
            const res = makeRes();

            getDealerAccountId.mockResolvedValue(null);

            await TransactionService.redeemCouponPoints(req, res);

            expect(getDealerAccountId).toHaveBeenCalledWith('D001');
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Dealer not found in Focus8. Contact support.' });
        });

        // ─── Downstream validations ───────────────────────────────────────

        test('should return 404 if coupon not found', async () => {
            const req = makeReq();
            const res = makeRes();

            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue(null);

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Coupon not found.' });
        });

        test('should return 404 if coupon already redeemed', async () => {
            const req = makeReq();
            const res = makeRes();

            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue({
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C001', pointsRedeemedBy: '9000000001'
            });

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Coupon Redeemed already.' });
        });

        // ─── Happy path ───────────────────────────────────────────────────

        test('should redeem points and return 200 for a valid Dealer', async () => {
            const req = makeReq();
            const res = makeRes();

            const mockDoc = { _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C001', pointsRedeemedBy: undefined };
            const updatedTxn = { ...mockDoc, pointsRedeemedBy: DEALER_USER.mobile, redeemablePoints: 150, updatedBy: DEALER_ID };
            const updatedUser = { ...DEALER_USER, rewardPoints: 650 };

            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue(mockDoc);
            User.findOne = jest.fn().mockResolvedValue(STATIC_USER);       // static user lookup
            Transaction.findOneAndUpdate = jest.fn().mockResolvedValue(updatedTxn);
            User.findOneAndUpdate = jest.fn().mockResolvedValue(updatedUser);
            transactionLedger.create = jest.fn().mockResolvedValue({});

            await TransactionService.redeemCouponPoints(req, res);

            expect(getDealerAccountId).toHaveBeenCalledWith('D001');
            expect(Transaction.findOneAndUpdate).toHaveBeenCalledWith(
                { UDID: 'TEST-UDID-001' },
                expect.objectContaining({ $set: expect.objectContaining({ pointsRedeemedBy: DEALER_USER.mobile }) }),
                { new: true }
            );
            expect(User.findOneAndUpdate).toHaveBeenCalled();
            expect(transactionLedger.create).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Successfully'),
                data: expect.objectContaining({ rewardPoints: 150, couponCode: 'C001' })
            }));
        });
    });
});
