const authController = require('../../controllers/authController');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const cashFreePaymentService = require('../../services/cashFreePaymentService');

// Mock the dependencies
jest.mock('../../models/User');
jest.mock('../../models/Transaction');
jest.mock('../../services/cashFreePaymentService');

describe('redeemCash', () => {
    // Setup mock next function
    const next = jest.fn();

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    test('should successfully redeem cash for existing user', async () => {
        // Mock data
        const req = {
            body: {
                mobile: '1234567890',
                name: 'Test User'
            },
            params: {
                qrCodeID: 'test-qr-123'
            }
        };

        // Mock user find
        const mockUser = { _id: 'user123' };
        User.findOne.mockResolvedValue(mockUser);

        // Mock transaction find
        const mockTransaction = {
            UDID: 'test-qr-123',
            value: 100,
            cashRedeemedBy: undefined
        };
        Transaction.findOne.mockResolvedValue(mockTransaction);

        // Mock payment service
        cashFreePaymentService.pay2Phone.mockResolvedValue({
            success: true
        });

        // Mock transaction update
        Transaction.findOneAndUpdate.mockResolvedValue({
            ...mockTransaction,
            updatedBy: 'user123',
            cashRedeemedBy: '1234567890'
        });

        // Execute test
        await authController.redeemCash(req, next);

        // Assertions
        expect(User.findOne).toHaveBeenCalledWith({ mobile: '1234567890' });
        expect(Transaction.findOne).toHaveBeenCalledWith({ UDID: 'test-qr-123' });
        expect(cashFreePaymentService.pay2Phone).toHaveBeenCalledWith('1234567890', 'Test User', 100);
        expect(Transaction.findOneAndUpdate).toHaveBeenCalledWith(
            { UDID: 'test-qr-123' },
            { updatedBy: 'user123', cashRedeemedBy: '1234567890' },
            { new: true }
        );
    });

    test('should return 404 if transaction not found', async () => {
        const req = {
            body: {
                mobile: '1234567890',
                name: 'Test User'
            },
            params: {
                qrCodeID: 'invalid-qr'
            }
        };

        Transaction.findOne.mockResolvedValue(null);

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({
            status: 404,
            message: 'Transaction not found for QR code: invalid-qr'
        });
    });

    test('should return 400 if coupon already redeemed', async () => {
        const req = {
            body: {
                mobile: '1234567890',
                name: 'Test User'
            },
            params: {
                qrCodeID: 'test-qr-123'
            }
        };

        Transaction.findOne.mockResolvedValue({
            UDID: 'test-qr-123',
            cashRedeemedBy: 'someone'
        });

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({
            status: 400,
            message: 'Coupon already redeemed.'
        });
    });

    test('should return 400 if payment fails', async () => {
        const req = {
            body: {
                mobile: '1234567890',
                name: 'Test User'
            },
            params: {
                qrCodeID: 'test-qr-123'
            }
        };

        Transaction.findOne.mockResolvedValue({
            UDID: 'test-qr-123',
            value: 100,
            cashRedeemedBy: undefined
        });

        cashFreePaymentService.pay2Phone.mockResolvedValue({
            success: false,
            message: 'Payment failed'
        });

        await authController.redeemCash(req, next);

        expect(next).toHaveBeenCalledWith({
            status: 400,
            message: 'Payment failed'
        });
    });
});
