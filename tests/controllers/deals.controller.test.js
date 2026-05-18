const mongoose = require('mongoose');

// Mock AWS S3 client
jest.mock('../../config/aws', () => ({
    upload: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Location: 'mock-url' }) }),
    deleteObject: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }),
}));

// Mock the AWS SDK
jest.mock('aws-sdk', () => ({
    config: { update: jest.fn() },
    S3: jest.fn().mockImplementation(() => ({})),
}));

// Mock the models
jest.mock('../../models/deals.model');
jest.mock('../../models/User');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const Deal = require('../../models/deals.model');
const UserModel = require('../../models/User');
const { getActiveDealsForUser, createDeal, updateDeal, deleteDeal } = require('../../controllers/deals.controller');

function makeRes() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

describe('DealsController', () => {
    afterEach(() => jest.clearAllMocks());

    describe('getActiveDealsForUser', () => {
        test('returns deals filtered by active=true, not-expired, and user category $in', async () => {
            const userId = new mongoose.Types.ObjectId();
            const cat1 = new mongoose.Types.ObjectId();
            const cat2 = new mongoose.Types.ObjectId();

            UserModel.findById.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue({ productCategories: [cat1, cat2] }),
                }),
            });

            const mockDeals = [{ _id: 'd1', title: 'Deal 1' }];
            Deal.find.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    sort: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue(mockDeals),
                    }),
                }),
            });

            const req = { user: { _id: userId } };
            const res = makeRes();
            await getActiveDealsForUser(req, res);

            expect(Deal.find).toHaveBeenCalledWith(expect.objectContaining({
                active: true,
                expirationDate: { $gte: expect.any(Date) },
                category: { $in: [cat1, cat2] },
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockDeals);
        });

        test('returns [] when user has no productCategories', async () => {
            UserModel.findById.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue({ productCategories: [] }),
                }),
            });

            const req = { user: { _id: new mongoose.Types.ObjectId() } };
            const res = makeRes();
            await getActiveDealsForUser(req, res);

            expect(Deal.find).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith([]);
        });

        test('returns [] when user has missing productCategories field', async () => {
            UserModel.findById.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue({}),
                }),
            });

            const req = { user: { _id: new mongoose.Types.ObjectId() } };
            const res = makeRes();
            await getActiveDealsForUser(req, res);

            expect(Deal.find).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith([]);
        });
    });

    describe('createDeal', () => {
        test('rejects when title is missing', async () => {
            const req = {
                user: { _id: new mongoose.Types.ObjectId(), mobile: '9999999999' },
                body: {
                    expirationDate: '2099-01-01',
                    category: new mongoose.Types.ObjectId(),
                    dealImage: 'data:image/png;base64,xxx',
                },
            };
            const res = makeRes();
            await createDeal(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'title, expirationDate and category are required' });
        });

        test('rejects when dealImage is missing', async () => {
            const req = {
                user: { _id: new mongoose.Types.ObjectId(), mobile: '9999999999' },
                body: {
                    title: 'Spring Sale',
                    expirationDate: '2099-01-01',
                    category: new mongoose.Types.ObjectId(),
                },
            };
            const res = makeRes();
            await createDeal(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Image is required' });
        });
    });

    describe('updateDeal', () => {
        test('preserves dealImageUrl when no new dealImage provided', async () => {
            const id = new mongoose.Types.ObjectId();
            const existing = { _id: id, dealImageUrl: 'https://old.example/x.png' };

            Deal.findById.mockResolvedValue(existing);
            Deal.findByIdAndUpdate.mockReturnValue({
                populate: jest.fn().mockResolvedValue({ ...existing, title: 'Updated' }),
            });

            const req = {
                params: { id: id.toString() },
                user: { _id: new mongoose.Types.ObjectId(), mobile: '9999999999' },
                body: { title: 'Updated' },
            };
            const res = makeRes();
            await updateDeal(req, res);

            // Make sure $set didn't include dealImageUrl (it would change the live image).
            expect(Deal.findByIdAndUpdate).toHaveBeenCalledWith(
                id.toString(),
                expect.not.objectContaining({ dealImageUrl: expect.anything() }),
                expect.any(Object),
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('deleteDeal', () => {
        test('succeeds even when S3 delete throws', async () => {
            const id = new mongoose.Types.ObjectId();
            Deal.findById.mockResolvedValue({ _id: id });

            // Force the S3 deleteObject promise to reject.
            const s3 = require('../../config/aws');
            s3.deleteObject.mockReturnValue({
                promise: jest.fn().mockRejectedValue(new Error('boom')),
            });

            Deal.findByIdAndDelete.mockResolvedValue({ _id: id });

            const req = { params: { id: id.toString() } };
            const res = makeRes();
            await deleteDeal(req, res);

            expect(Deal.findByIdAndDelete).toHaveBeenCalledWith(id.toString());
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ message: 'Deal deleted successfully' });
        });
    });
});
