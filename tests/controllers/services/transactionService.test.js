const TransactionService = require('../../../services/transactionService');
const Transaction = require('../../../models/Transaction');
const User = require('../../../models/User');
const mongoose = require('mongoose');

// Mock the logger to prevent actual logging during tests
jest.mock('../../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
}));

describe('TransactionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getTransactions with salesExecutiveMobile', () => {
        test('should return transactions for multiple dealers under sales executive', async () => {
            // Mock data
            const mockBody = { 
                page: 1,
                limit: 10,
                salesExecutiveMobile: '9876543210'    
            };
            
            // Mock dealers assigned to sales executive  
            const mockDealers = [
                { 
                    _id: new mongoose.Types.ObjectId(),
                    mobile: '1234567890',
                    accountType: 'Dealer',
                    salesExecutiveMobile: '9876543210'
                },
                { 
                    _id: new mongoose.Types.ObjectId(),
                    mobile: '9876543211',
                    accountType: 'Dealer',
                    salesExecutiveMobile: '9876543210'
                }
            ];
            
            // Mock transactions for these dealers
            const mockTransactions = [
                { 
                    _id: new mongoose.Types.ObjectId(),
                    pointsRedeemedBy: '1234567890',
                    couponCode: '12345'
                },
                { 
                    _id: new mongoose.Types.ObjectId(),
                    cashRedeemedBy: '9876543211',
                    couponCode: '67890'
                }
            ];

            const mockAggregateResult = [
                {
                    _id: new mongoose.Types.ObjectId(),
                    batchId: new mongoose.Types.ObjectId(),
                    couponCode: '12345',
                    pointsRedeemedBy: '1234567890'
                },
                {
                    _id: new mongoose.Types.ObjectId(),
                    batchId: new mongoose.Types.ObjectId(),
                    couponCode: '67890',
                    cashRedeemedBy: '9876543211'
                }
            ];

            const mockTotalResult = [{ total: 2 }];

            // Setup mocks
            User.findOne = jest.fn().mockResolvedValue(mockBody);  
            User.find = jest.fn().mockResolvedValue(mockDealers);  
            Transaction.find = jest.fn().mockResolvedValue(mockTransactions);  
            Transaction.aggregate = jest.fn()
                .mockImplementation((pipeline) => {
                    if (pipeline.some(stage => stage.$count)) {
                        return Promise.resolve(mockTotalResult);
                    }
                    return Promise.resolve(mockAggregateResult);
                });

            // Execute test
            const result = await TransactionService.getTransactions({
                salesExecutiveMobile: '9876543210',
                page: 1,
                limit: 10
            });

            // Assertions
            expect(result).toBeDefined();
            expect(result.total).toBe(2); 
            expect(result.transactionsData).toEqual(mockAggregateResult); 
            expect(User.findOne).toHaveBeenCalled();
            expect(User.find).toHaveBeenCalled();
            expect(Transaction.find).toHaveBeenCalled();
            expect(Transaction.aggregate).toHaveBeenCalled();
        });

        test('should throw error if sales executive does not exist', async () => {
            // Mock User.findOne to return null (no sales executive found)
            User.findOne = jest.fn().mockResolvedValue(null);
            
            await expect(TransactionService.getTransactions({
                salesExecutiveMobile: '9876543210'
            })).rejects.toThrow('Sales Executive with mobile number 9876543210 not found.');

            expect(User.findOne).toHaveBeenCalled();
        });

        test('should return error message when no dealers found under sales executive', async () => {
            // Mock data
            const mockBody = { 
                page: 1,
                limit: 10,
                salesExecutiveMobile: '9876543210'    
            };
            

            // Setup mocks
            User.findOne = jest.fn().mockResolvedValue(mockBody);
            User.find = jest.fn().mockResolvedValue([]);

            // Execute and assert
            await expect(TransactionService.getTransactions({
                salesExecutiveMobile: '9876543210'
            })).rejects.toThrow('No dealers found for Sales Executive with mobile number 9876543210.');

            expect(User.findOne).toHaveBeenCalled();
            expect(User.find).toHaveBeenCalled();
        });

        test('should handle database error when fetching dealers', async () => {
            // Mock database error
            const dbError = new Error('Database connection failed');
            User.findOne = jest.fn().mockRejectedValue(dbError);

            // Execute and assert
            await expect(TransactionService.getTransactions({
                salesExecutiveMobile: '9876543210'
            })).rejects.toThrow('Database connection failed');

            expect(User.findOne).toHaveBeenCalled();
        });
    });
});
