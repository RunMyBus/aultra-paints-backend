// Must be set before requiring transactionService — redeemEligibleAccountTypes is
// captured as a module-level constant at require() time.
process.env.POINTS_REDEEM_ELIGIBLE_ACCOUNT_TYPES = 'Dealer,Painter';
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

const DEALER_ID = new mongoose.Types.ObjectId();

const DEALER_USER = { _id: DEALER_ID, mobile: '9000000001', accountType: 'Dealer', dealerCode: 'D001', rewardPoints: 500 };
const PAINTER_ID = new mongoose.Types.ObjectId();
const PAINTER_USER = { _id: PAINTER_ID, mobile: '9000000002', accountType: 'Painter', dealerCode: 'P001', rewardPoints: 200 };

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

        /** Wire up the four collaborators that every happy path needs. */
        function wireOk({ coupon, updatedTxn, updatedUser }) {
            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue(coupon);
            Transaction.findOneAndUpdate = jest.fn().mockResolvedValue(updatedTxn);
            User.findOneAndUpdate = jest.fn().mockResolvedValue(updatedUser);
            transactionLedger.create = jest.fn().mockResolvedValue({});
        }

        // ─── Eligibility guards ───────────────────────────────────────────

        test('returns 403 if user account type is not eligible for points redemption', async () => {
            const req = makeReq({ accountType: 'SubDealer' });
            const res = makeRes();

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('Only') });
            expect(getDealerAccountId).not.toHaveBeenCalled();
        });

        test('returns 403 if dealer has no dealerCode', async () => {
            const req = makeReq({ dealerCode: undefined });
            const res = makeRes();

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Dealer code not set. Contact support.' });
            expect(getDealerAccountId).not.toHaveBeenCalled();
        });

        test('returns 403 if dealer not found in Focus8', async () => {
            const req = makeReq();
            const res = makeRes();

            getDealerAccountId.mockResolvedValue(null);

            await TransactionService.redeemCouponPoints(req, res);

            expect(getDealerAccountId).toHaveBeenCalledWith('D001');
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Dealer not found in Focus8. Contact support.' });
        });

        // ─── Lookup / idempotency ─────────────────────────────────────────

        test('returns 404 if coupon not found', async () => {
            const req = makeReq();
            const res = makeRes();

            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue(null);

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Coupon not found.' });
        });

        test('returns 404 only when BOTH tracks already redeemed', async () => {
            const req = makeReq();
            const res = makeRes();

            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue({
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C001',
                pointsRedeemedBy: '9000000001',
                cashRedeemedBy:   '9000000001',
            });
            // No update or credit should happen
            Transaction.findOneAndUpdate = jest.fn();
            User.findOneAndUpdate = jest.fn();
            transactionLedger.create = jest.fn();

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Coupon Redeemed already.' });
            expect(Transaction.findOneAndUpdate).not.toHaveBeenCalled();
            expect(User.findOneAndUpdate).not.toHaveBeenCalled();
            expect(transactionLedger.create).not.toHaveBeenCalled();
        });

        // ─── Happy paths — credit shape per track combination ─────────────

        test('credits both tracks when both are unredeemed (full coupon)', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C001',
                redeemablePoints: 150, value: 200,
                pointsRedeemedBy: undefined, cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: DEALER_USER.mobile,
                cashRedeemedBy:   DEALER_USER.mobile,
                updatedBy: DEALER_ID,
            };
            const updatedUser = { ...DEALER_USER, rewardPoints: 650, cash: 200 };
            wireOk({ coupon, updatedTxn, updatedUser });

            await TransactionService.redeemCouponPoints(req, res);

            // Coupon update locks BOTH tracks
            expect(Transaction.findOneAndUpdate).toHaveBeenCalledWith(
                { UDID: 'TEST-UDID-001' },
                expect.objectContaining({ $set: expect.objectContaining({
                    pointsRedeemedBy: DEALER_USER.mobile,
                    pointsRedeemedAt: expect.any(Date),
                    cashRedeemedBy:   DEALER_USER.mobile,
                    cashRedeemedAt:   expect.any(Date),
                    updatedBy: DEALER_ID,
                }) }),
                { new: true }
            );

            // User $inc has BOTH balances and ONLY them
            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: DEALER_ID },
                { $inc: { rewardPoints: 150, cash: 200 } },
                { new: true }
            );

            // One ledger row carrying both tracks in their own fields
            expect(transactionLedger.create).toHaveBeenCalledTimes(1);
            expect(transactionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
                pointsCredited:      150,
                pointsBalance:     650,                      // user.rewardPoints after credit
                cashReward:  200,
                cashBalance: 200,                      // user.cash after credit
                userId:      DEALER_ID,
                narration:   expect.stringMatching(/150 pts \+ 200 cash credited/i),
            }));

            // Response payload exposes per-track credits independently
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Successfully'),
                data: { rewardPoints: 150, cashReward: 200, couponCode: 'C001' },
            }));
        });

        test('credits only points when value is 0 (points-only coupon)', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C002',
                redeemablePoints: 100, value: 0,
                pointsRedeemedBy: undefined, cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: DEALER_USER.mobile,
                cashRedeemedBy:   DEALER_USER.mobile,    // also locked, even though 0
                updatedBy: DEALER_ID,
            };
            const updatedUser = { ...DEALER_USER, rewardPoints: 600, cash: 0 };
            wireOk({ coupon, updatedTxn, updatedUser });

            await TransactionService.redeemCouponPoints(req, res);

            // $inc has only rewardPoints (cash branch is 0 so the key is omitted)
            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: DEALER_ID },
                { $inc: { rewardPoints: 100 } },
                { new: true }
            );

            // Single ledger row — points fields populated, cash side at 0
            expect(transactionLedger.create).toHaveBeenCalledTimes(1);
            expect(transactionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
                pointsCredited: 100, pointsBalance: 600,
                cashReward: 0, cashBalance: 0,
                narration: expect.stringMatching(/100 pts credited/i),
            }));

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { rewardPoints: 100, cashReward: 0, couponCode: 'C002' },
            }));
        });

        test('credits only cash when redeemablePoints is 0 (cash-only coupon)', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C003',
                redeemablePoints: 0, value: 250,
                pointsRedeemedBy: undefined, cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: DEALER_USER.mobile,
                cashRedeemedBy:   DEALER_USER.mobile,
                updatedBy: DEALER_ID,
            };
            const updatedUser = { ...DEALER_USER, rewardPoints: 500, cash: 250 };
            wireOk({ coupon, updatedTxn, updatedUser });

            await TransactionService.redeemCouponPoints(req, res);

            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: DEALER_ID },
                { $inc: { cash: 250 } },
                { new: true }
            );

            // Single ledger row — cash fields populated, points side at 0
            expect(transactionLedger.create).toHaveBeenCalledTimes(1);
            expect(transactionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
                pointsCredited: 0, pointsBalance: 500,           // user.rewardPoints unchanged
                cashReward: 250, cashBalance: 250,
                narration: expect.stringMatching(/250 cash credited/i),
            }));

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { rewardPoints: 0, cashReward: 250, couponCode: 'C003' },
            }));
        });

        // ─── Partial redemption (one track was already used earlier) ──────

        test('credits only points when cash track was already redeemed earlier', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C004',
                redeemablePoints: 120, value: 200,
                pointsRedeemedBy: undefined,
                cashRedeemedBy: '9000000099',                 // already done
                cashRedeemedAt: new Date('2026-01-01'),
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: DEALER_USER.mobile,
                updatedBy: DEALER_ID,
            };
            const updatedUser = { ...DEALER_USER, rewardPoints: 620, cash: 0 };
            wireOk({ coupon, updatedTxn, updatedUser });

            await TransactionService.redeemCouponPoints(req, res);

            // $set must NOT touch cashRedeemedBy/cashRedeemedAt — they're already set
            const setArg = Transaction.findOneAndUpdate.mock.calls[0][1].$set;
            expect(setArg).toEqual({
                updatedBy: DEALER_ID,
                pointsRedeemedBy: DEALER_USER.mobile,
                pointsRedeemedAt: expect.any(Date),
            });
            expect(setArg).not.toHaveProperty('cashRedeemedBy');
            expect(setArg).not.toHaveProperty('cashRedeemedAt');

            // $inc has only rewardPoints
            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: DEALER_ID },
                { $inc: { rewardPoints: 120 } },
                { new: true }
            );

            // Single ledger row for the points credit — cash side stays at 0
            // (cash was redeemed earlier; this scan touches only points)
            expect(transactionLedger.create).toHaveBeenCalledTimes(1);
            expect(transactionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
                pointsCredited: 120, pointsBalance: 620,
                cashReward: 0, cashBalance: 0,
                narration: expect.stringMatching(/120 pts credited/i),
            }));

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { rewardPoints: 120, cashReward: 0, couponCode: 'C004' },
            }));
        });

        test('credits only cash when points track was already redeemed earlier', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C005',
                redeemablePoints: 90, value: 50,
                pointsRedeemedBy: '9000000099',                 // already done
                pointsRedeemedAt: new Date('2026-01-01'),
                cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                cashRedeemedBy: DEALER_USER.mobile,
                updatedBy: DEALER_ID,
            };
            const updatedUser = { ...DEALER_USER, rewardPoints: 500, cash: 50 };
            wireOk({ coupon, updatedTxn, updatedUser });

            await TransactionService.redeemCouponPoints(req, res);

            const setArg = Transaction.findOneAndUpdate.mock.calls[0][1].$set;
            expect(setArg).toEqual({
                updatedBy: DEALER_ID,
                cashRedeemedBy: DEALER_USER.mobile,
                cashRedeemedAt: expect.any(Date),
            });
            expect(setArg).not.toHaveProperty('pointsRedeemedBy');
            expect(setArg).not.toHaveProperty('pointsRedeemedAt');

            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: DEALER_ID },
                { $inc: { cash: 50 } },
                { new: true }
            );

            // Single ledger row for the cash credit — points side stays at 0
            // (points were redeemed earlier; this scan touches only cash)
            expect(transactionLedger.create).toHaveBeenCalledTimes(1);
            expect(transactionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
                pointsCredited: 0, pointsBalance: 500,
                cashReward: 50, cashBalance: 50,
                narration: expect.stringMatching(/50 cash credited/i),
            }));

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { rewardPoints: 0, cashReward: 50, couponCode: 'C005' },
            }));
        });

        // ─── Edge: zero-value coupon ──────────────────────────────────────

        test('does not credit user or write a ledger row when both rewards are 0', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C006',
                redeemablePoints: 0, value: 0,
                pointsRedeemedBy: undefined, cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: DEALER_USER.mobile,
                cashRedeemedBy:   DEALER_USER.mobile,
                updatedBy: DEALER_ID,
            };
            wireOk({ coupon, updatedTxn, updatedUser: undefined });
            // We still want to assert these aren't called
            User.findOneAndUpdate = jest.fn();
            transactionLedger.create = jest.fn();

            await TransactionService.redeemCouponPoints(req, res);

            // The Transaction is still updated (both tracks locked) so the
            // coupon can never be reused even though it credits nothing.
            expect(Transaction.findOneAndUpdate).toHaveBeenCalled();
            expect(User.findOneAndUpdate).not.toHaveBeenCalled();
            expect(transactionLedger.create).not.toHaveBeenCalled();

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { rewardPoints: 0, cashReward: 0, couponCode: 'C006' },
            }));
        });

        // ─── User-not-found after credit attempt ──────────────────────────

        test('returns 404 if the User update returns no document', async () => {
            const req = makeReq();
            const res = makeRes();

            const coupon = {
                _id: 'txn1', UDID: 'TEST-UDID-001', couponCode: 'C007',
                redeemablePoints: 100, value: 0,
                pointsRedeemedBy: undefined, cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: DEALER_USER.mobile,
                cashRedeemedBy:   DEALER_USER.mobile,
                updatedBy: DEALER_ID,
            };
            getDealerAccountId.mockResolvedValue(42);
            Transaction.findOne = jest.fn().mockResolvedValue(coupon);
            Transaction.findOneAndUpdate = jest.fn().mockResolvedValue(updatedTxn);
            User.findOneAndUpdate = jest.fn().mockResolvedValue(null);
            transactionLedger.create = jest.fn();

            await TransactionService.redeemCouponPoints(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'User not found for update.' });
            expect(transactionLedger.create).not.toHaveBeenCalled();
        });

        // ─── Painter happy path (eligibility wiring) ──────────────────────

        test('credits a Painter user the same way as a Dealer', async () => {
            const req = { user: { ...PAINTER_USER }, body: { qrCodeUrl: QR_URL } };
            const res = makeRes();

            const coupon = {
                _id: 'txn2', UDID: 'TEST-UDID-001', couponCode: 'C008',
                redeemablePoints: 80, value: 40,
                pointsRedeemedBy: undefined, cashRedeemedBy: undefined,
            };
            const updatedTxn = { ...coupon,
                pointsRedeemedBy: PAINTER_USER.mobile,
                cashRedeemedBy:   PAINTER_USER.mobile,
                updatedBy: PAINTER_ID,
            };
            const updatedUser = { ...PAINTER_USER, rewardPoints: 280, cash: 40 };

            getDealerAccountId.mockResolvedValue(55);
            Transaction.findOne = jest.fn().mockResolvedValue(coupon);
            Transaction.findOneAndUpdate = jest.fn().mockResolvedValue(updatedTxn);
            User.findOneAndUpdate = jest.fn().mockResolvedValue(updatedUser);
            transactionLedger.create = jest.fn().mockResolvedValue({});

            await TransactionService.redeemCouponPoints(req, res);

            expect(getDealerAccountId).toHaveBeenCalledWith('P001');
            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: PAINTER_ID },
                { $inc: { rewardPoints: 80, cash: 40 } },
                { new: true }
            );
            expect(transactionLedger.create).toHaveBeenCalledTimes(1);
            expect(transactionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
                pointsCredited: 80, pointsBalance: 280,
                cashReward: 40, cashBalance: 40,
                narration: expect.stringMatching(/80 pts \+ 40 cash credited/i),
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: { rewardPoints: 80, cashReward: 40, couponCode: 'C008' },
            }));
        });
    });
});
