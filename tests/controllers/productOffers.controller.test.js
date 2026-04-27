const { searchProductOffers, createProductOffer, updateProductOffer } = require('../../controllers/productOffers.controller');
const productOffersModel = require('../../models/productOffers.model');
const ProductPriceModel = require('../../models/ProductPrice');
const UserModel = require('../../models/User');
const mongoose = require('mongoose');

// Mock AWS configuration
jest.mock('../../config/aws', () => ({
    upload: jest.fn(),
    deleteObject: jest.fn(),
}));

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
    config: {
        update: jest.fn()
    },
    S3: jest.fn().mockImplementation(() => ({
        upload: jest.fn().mockReturnThis(),
        promise: jest.fn().mockResolvedValue({ Location: 'mock-url' })
    }))
}));

jest.mock('sharp', () => jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('thumbnail-data')),
})));

// Mock the models
jest.mock('../../models/productOffers.model');
jest.mock('../../models/ProductPrice');
jest.mock('../../models/User');

const s3Mock = require('../../config/aws');

describe('ProductOffersController', () => {
    describe('searchProductOffers', () => {
        test('should return product offers with correct price based on dealerId (Dealer with State, Zone, and District)', async () => {
            const mockBody = {
                page: 1,
                limit: 10
            };

            const mockUser = {
                _id: new mongoose.Types.ObjectId('67e2d56857f5292cd11bc773'),
                userType: 'Dealer',
                state: 'AP001',
                zone: 'Z001',
                district: 'D001'
            };

            const mockProductOffers = [
                {
                    _id: new mongoose.Types.ObjectId('67dd1140d808657d711f5db5'),
                    productOfferDescription: 'Tester',
                    validUntil: new Date('2025-03-20T18:30:00.000Z'),
                    productOfferStatus: 'Active',
                    cashback: 10,
                    redeemPoints: 20,
                    price: [
                        { refId: 'AP001', price: 2000 }, // State price
                        { refId: 'Z001', price: 1800 },  // Zone price
                        { refId: 'D001', price: 2500 },  // District price
                        { refId: 'All', price: 1500 }    // Default price
                    ],
                    productOfferImageUrl: 'https://XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/67dd1140d808657d711f5db5.png',
                    createdAt: new Date('2025-03-21T07:12:00.893Z'),
                    updatedAt: new Date('2025-03-24T06:50:46.628Z')
                }
            ];

            const mockPriceData = {
                _id: new mongoose.Types.ObjectId('67e2e8f9792e075aba48756a'),
                productOfferId: '67dd1140d808657d711f5db5',
                dealerId: '67e2d56857f5292cd11bc773',
                price: 2500, // Using district price as it has lowest priority
                createdAt: new Date('2025-03-25T17:33:45.770Z'),
                updatedAt: new Date('2025-03-25T17:33:45.770Z')
            };

            productOffersModel.find.mockReturnValue({
                skip: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue(mockProductOffers)
                    })
                })
            });

            productOffersModel.countDocuments.mockResolvedValue(1);
            ProductPriceModel.findOne.mockResolvedValue(mockPriceData);

            const mockReq = {
                body: mockBody,
                user: mockUser
            };

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await searchProductOffers(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                data: [{
                    productPrice: 2500  // District price should be used as it has Lowest priority
                }],
                total: 1,
                pages: 1,
                currentPage: 1
            });
        });



        test('should return product offers with correct price based on dealerId (Dealer Mapped - State  and zone)', async () => {
            const mockBody = {
                page: 1,
                limit: 10
            };

            const mockUser = {
                _id: new mongoose.Types.ObjectId('67e2d56857f5292cd11bc773'),
                userType : 'Dealer',
                state: 'AP001',
                zone: 'Z001'
            };

            const mockProductOffers = [
                {
                    _id: new mongoose.Types.ObjectId('67dd1140d808657d711f5db5'),
                    productOfferDescription: 'Tester',
                    validUntil: new Date('2025-03-20T18:30:00.000Z'),
                    productOfferStatus: 'Active',
                    cashback: 10,
                    redeemPoints: 20,
                    price: [
                        { refId: 'AP001', price: 2000 }, // State price
                        { refId: 'Z001', price: 1800 },  // Zone price
                    ],
                    productOfferImageUrl: 'https://XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/67dd1140d808657d711f5db5.png'
                }
            ];


            const mockPriceData = {
                _id: new mongoose.Types.ObjectId('67e2e8f9792e075aba48757b'),
                productOfferId: '67dd1140d808657d711f5db5',
                dealerId: '67e2d56857f5292cd11bc773',
                price: 1800, // Using zone price as it has lowest priority
                createdAt: new Date('2025-03-25T17:33:45.770Z'),
                updatedAt: new Date('2025-03-25T17:33:45.770Z')
            };

            productOffersModel.find.mockReturnValue({
                skip: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue(mockProductOffers)
                    })
                })
            });

            productOffersModel.countDocuments.mockResolvedValue(1);
            ProductPriceModel.findOne.mockResolvedValue(mockPriceData);


            const mockReq = {
                body: mockBody,
                user: mockUser
            };

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await searchProductOffers(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                data: [{
                    productPrice: 1800  // Using zone price as it has lowest priority
                }],
                total: 1,
                pages: 1,
                currentPage: 1
            });
        });

        test('should use fallback "All" price for product offers when dealer has no state, zone, or district mapping', async () => {
            const mockBody = {
                page: 1,
                limit: 10
            };

            const mockUser = {
                _id: new mongoose.Types.ObjectId('67e2d56857f5292cd11bc773'),
               userType : 'Dealer',
                state: '',
                district: ''
            };

            const mockProductOffers = [
                {
                    _id: new mongoose.Types.ObjectId('67dd1140d808657d711f5db5'),
                    productOfferDescription: 'Fallback Offer',
                    validUntil: new Date('2025-03-20T18:30:00.000Z'),
                    productOfferStatus: 'Active',
                    cashback: 10,
                    redeemPoints: 20,
                    price: [
                        { refId: 'All', price: 1500 }
                    ],
                    productOfferImageUrl: 'https://XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/67dd1140d808657d711f5db5.png',
                    createdAt: new Date('2025-03-21T07:12:00.893Z'),
                    updatedAt: new Date('2025-03-24T06:50:46.628Z')
                }
            ];


            const mockPriceData = {
                _id: new mongoose.Types.ObjectId('67e2e8f9792e075aba48756a'),
                productOfferId: '67dd1140d808657d711f5db5',
                dealerId: '67e2d56857f5292cd11bc773',
                price: 1500, // Using district price as it has lowest priority
                createdAt: new Date('2025-03-25T17:33:45.770Z'),
                updatedAt: new Date('2025-03-25T17:33:45.770Z')
            };

            productOffersModel.find.mockReturnValue({
                skip: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue(mockProductOffers)
                    })
                })
            });

            productOffersModel.countDocuments.mockResolvedValue(1);
            ProductPriceModel.findOne.mockResolvedValue(mockPriceData);


            const mockReq = {
                body: mockBody,
                user: mockUser
            };

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await searchProductOffers(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                data: [{
                    productPrice: 1500  // productPrice field
                }],
                total: 1,
                pages: 1,
                currentPage: 1
            });
        });



        // Keep these tests exactly as they were since they're passing
        test('should return empty result when no product offers are found', async () => {
            productOffersModel.find.mockReturnValue({
                skip: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                        sort: jest.fn().mockResolvedValue([])
                    })
                })
            });

            productOffersModel.countDocuments.mockResolvedValue(0);

            const mockReq = {
                body: { page: 1, limit: 10 },
                user: { _id: new mongoose.Types.ObjectId('67e2d56857f5292cd11bc773'), state: 'AP001' }
            };

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await searchProductOffers(mockReq, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith({
                data: [],
                total: 0,
                pages: 0,
                currentPage: 1
            });
        });

        test('should handle database error gracefully', async () => {
            productOffersModel.find.mockImplementation(() => {
                throw new Error('Database error');
            });

            const mockReq = {
                body: { page: 1, limit: 10 },
                user: { _id: new mongoose.Types.ObjectId('67e2d56857f5292cd11bc773'), state: 'AP001' }
            };

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await searchProductOffers(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Something went wrong'
            });
        });

        // ── Route scheme filtering (recent change) ────────────────────────────
        describe('routeScheme filtering', () => {
            const DEALER_ID = new mongoose.Types.ObjectId();
            const SE_MOBILE = '9876500001';

            function wireFind(offers = []) {
                productOffersModel.find.mockReturnValue({
                    skip: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            sort: jest.fn().mockResolvedValue(offers),
                        }),
                    }),
                });
                productOffersModel.countDocuments.mockResolvedValue(offers.length);
                ProductPriceModel.findOne.mockResolvedValue(null);
            }

            beforeEach(() => {
                jest.clearAllMocks();
                wireFind();
            });

            test('SuperUser bypasses routeScheme filter — query has neither $or nor $and for routeScheme', async () => {
                const req = {
                    body: { page: 1, limit: 10 },
                    user: { _id: DEALER_ID, accountType: 'SuperUser', mobile: '9999999999' },
                };
                const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

                await searchProductOffers(req, res);

                const queryArg = productOffersModel.find.mock.calls[0][0];
                // The only clause should be offerAvailable:true — no routeScheme filter
                expect(queryArg).not.toHaveProperty('$and');
                // If there IS an $or it must not contain any routeScheme condition
                if (queryArg['$or']) {
                    const hasRouteFilter = queryArg['$or'].some(
                        clause => clause.routeScheme !== undefined
                    );
                    expect(hasRouteFilter).toBe(false);
                }
                expect(queryArg.offerAvailable).toBe(true);
            });

            test('Dealer gets routeScheme filter scoped to their salesExecutive mobile', async () => {
                const req = {
                    body: { page: 1, limit: 10 },
                    user: { _id: DEALER_ID, accountType: 'Dealer', salesExecutive: SE_MOBILE },
                };
                const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

                await searchProductOffers(req, res);

                const queryArg = productOffersModel.find.mock.calls[0][0];
                // Expect routeScheme clauses to be present (either via $or at top level or inside $and)
                const flatClauses = queryArg['$or'] ||
                    (queryArg['$and'] || []).flatMap(c => c['$or'] || []);
                const routeClauses = flatClauses.filter(c => c.routeScheme !== undefined);
                expect(routeClauses.length).toBeGreaterThan(0);
                // One of the clauses must allow offers with SE_MOBILE
                const hasMobileClause = routeClauses.some(c => c.routeScheme === SE_MOBILE);
                expect(hasMobileClause).toBe(true);
            });

            test('SalesExecutive gets routeScheme filter scoped to their own mobile', async () => {
                const req = {
                    body: { page: 1, limit: 10 },
                    user: { _id: DEALER_ID, accountType: 'SalesExecutive', mobile: SE_MOBILE },
                };
                // SalesExecutive path also calls UserModel.find — mock it
                const UserModel = require('../../models/User');
                jest.mock('../../models/User');
                UserModel.find = jest.fn().mockResolvedValue([]);

                const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

                await searchProductOffers(req, res);

                const queryArg = productOffersModel.find.mock.calls[0][0];
                const flatClauses = queryArg['$or'] ||
                    (queryArg['$and'] || []).flatMap(c => c['$or'] || []);
                const hasMobileClause = flatClauses.some(c => c.routeScheme === SE_MOBILE);
                expect(hasMobileClause).toBe(true);
            });

            test('sort argument is { createdAt: -1 }', async () => {
                const req = {
                    body: { page: 1, limit: 10 },
                    user: { _id: DEALER_ID, accountType: 'SuperUser', mobile: '9999999999' },
                };
                const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

                await searchProductOffers(req, res);

                // The sort() call is chained on the find query — grab its argument
                const findChain = productOffersModel.find.mock.results[0].value;
                const sortArg = findChain.skip.mock.results[0].value
                    .limit.mock.results[0].value
                    .sort.mock.calls[0][0];
                expect(sortArg).toEqual({ createdAt: -1 });
            });
        });
    });

    // ── Thumbnail generation (createProductOffer) ─────────────────────────────
    describe('createProductOffer', () => {
        const OFFER_ID = new mongoose.Types.ObjectId('67dd1140d808657d711f5db5');
        const ORIGINAL_URL = `https://bucket.blr1.digitaloceanspaces.com/${OFFER_ID}.png`;
        const THUMB_URL = `https://bucket.blr1.digitaloceanspaces.com/${OFFER_ID}_thumbnail.png`;
        const VALID_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const VALID_PRICE = JSON.stringify([{ All: 1000 }]);

        function wireS3Upload() {
            s3Mock.upload
                .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Location: ORIGINAL_URL }) })
                .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Location: THUMB_URL }) });
        }

        beforeEach(() => {
            jest.clearAllMocks();
            productOffersModel.findOne.mockResolvedValue(null);
            productOffersModel.mockImplementation(() => ({
                save: jest.fn().mockResolvedValue({ _id: OFFER_ID }),
            }));
            productOffersModel.updateOne.mockResolvedValue({});
            UserModel.find.mockResolvedValue([]);
            ProductPriceModel.deleteMany.mockResolvedValue({});
            ProductPriceModel.insertMany.mockResolvedValue({});
            wireS3Upload();
        });

        test('returns 400 when productOfferImage is missing', async () => {
            const req = {
                body: {
                    productOfferDescription: 'Test',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await createProductOffer(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Image is required' });
            expect(s3Mock.upload).not.toHaveBeenCalled();
        });

        test('uploads original image to S3 with correct key', async () => {
            const req = {
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferDescription: 'Test',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await createProductOffer(req, res);

            expect(s3Mock.upload).toHaveBeenCalledWith(
                expect.objectContaining({ Key: `${OFFER_ID}.png`, ACL: 'public-read' })
            );
        });

        test('uploads thumbnail to S3 with _thumbnail suffix key', async () => {
            const req = {
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferDescription: 'Test',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await createProductOffer(req, res);

            expect(s3Mock.upload).toHaveBeenCalledTimes(2);
            expect(s3Mock.upload).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ Key: `${OFFER_ID}_thumbnail.png`, ACL: 'public-read' })
            );
        });

        test('saves both productOfferImageUrl and productOfferThumbnailUrl in updateOne', async () => {
            const req = {
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferDescription: 'Test',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await createProductOffer(req, res);

            expect(productOffersModel.updateOne).toHaveBeenCalledWith(
                { _id: OFFER_ID },
                { $set: { productOfferImageUrl: ORIGINAL_URL, productOfferThumbnailUrl: THUMB_URL } }
            );
        });

        test('returns 201 on success', async () => {
            const req = {
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferDescription: 'Test',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await createProductOffer(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
        });

        test('returns 400 when offer with same description already exists', async () => {
            productOffersModel.findOne.mockResolvedValue({ _id: OFFER_ID, productOfferDescription: 'Test' });

            const req = {
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferDescription: 'Test',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await createProductOffer(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(s3Mock.upload).not.toHaveBeenCalled();
        });
    });

    // ── Thumbnail generation (updateProductOffer) ─────────────────────────────
    describe('updateProductOffer', () => {
        const OFFER_ID = '67dd1140d808657d711f5db5';
        const OLD_ORIGINAL_URL = `https://bucket.blr1.digitaloceanspaces.com/${OFFER_ID}.png`;
        const OLD_THUMB_URL = `https://bucket.blr1.digitaloceanspaces.com/${OFFER_ID}_thumbnail.png`;
        const NEW_ORIGINAL_URL = `https://bucket.blr1.digitaloceanspaces.com/${OFFER_ID}_new.png`;
        const NEW_THUMB_URL = `https://bucket.blr1.digitaloceanspaces.com/${OFFER_ID}_new_thumbnail.png`;
        const VALID_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const VALID_PRICE = JSON.stringify([{ All: 1000 }]);

        function wireS3Upload() {
            s3Mock.upload
                .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Location: NEW_ORIGINAL_URL }) })
                .mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Location: NEW_THUMB_URL }) });
        }

        // updateProductOffer calls res({status, ...}) instead of res.status().json()
        // so res must be a jest.fn() that is also callable as a function
        function makeRes() {
            return jest.fn();
        }

        beforeEach(() => {
            jest.clearAllMocks();
            productOffersModel.findOne.mockResolvedValue(null);
            productOffersModel.findByIdAndUpdate.mockResolvedValue({ _id: OFFER_ID });
            s3Mock.deleteObject.mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
            UserModel.find.mockResolvedValue([]);
            ProductPriceModel.deleteMany.mockResolvedValue({});
            ProductPriceModel.insertMany.mockResolvedValue({});
            wireS3Upload();
        });

        test('deletes old original image from S3 when new image is provided', async () => {
            const req = {
                params: { id: OFFER_ID },
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferImageUrl: OLD_ORIGINAL_URL,
                    productOfferThumbnailUrl: OLD_THUMB_URL,
                    productOfferDescription: 'Updated',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };

            await updateProductOffer(req, makeRes());

            expect(s3Mock.deleteObject).toHaveBeenCalledWith(
                expect.objectContaining({ Key: `${OFFER_ID}.png` })
            );
        });

        test('deletes old thumbnail from S3 when new image is provided', async () => {
            const req = {
                params: { id: OFFER_ID },
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferImageUrl: OLD_ORIGINAL_URL,
                    productOfferThumbnailUrl: OLD_THUMB_URL,
                    productOfferDescription: 'Updated',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };

            await updateProductOffer(req, makeRes());

            expect(s3Mock.deleteObject).toHaveBeenCalledWith(
                expect.objectContaining({ Key: `${OFFER_ID}_thumbnail.png` })
            );
        });

        test('uploads new original and thumbnail to S3 when new image is provided', async () => {
            const req = {
                params: { id: OFFER_ID },
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferImageUrl: OLD_ORIGINAL_URL,
                    productOfferThumbnailUrl: OLD_THUMB_URL,
                    productOfferDescription: 'Updated',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };

            await updateProductOffer(req, makeRes());

            expect(s3Mock.upload).toHaveBeenCalledTimes(2);
            expect(s3Mock.upload).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ Key: `${OFFER_ID}.png`, ACL: 'public-read' })
            );
            expect(s3Mock.upload).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ Key: `${OFFER_ID}_thumbnail.png`, ACL: 'public-read' })
            );
        });

        test('passes productOfferThumbnailUrl to findByIdAndUpdate when image is updated', async () => {
            const req = {
                params: { id: OFFER_ID },
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferImageUrl: OLD_ORIGINAL_URL,
                    productOfferThumbnailUrl: OLD_THUMB_URL,
                    productOfferDescription: 'Updated',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };

            await updateProductOffer(req, makeRes());

            const updateArg = productOffersModel.findByIdAndUpdate.mock.calls[0][1];
            expect(updateArg).toHaveProperty('productOfferThumbnailUrl', NEW_THUMB_URL);
            expect(updateArg).toHaveProperty('productOfferImageUrl', NEW_ORIGINAL_URL);
        });

        test('does not call S3 upload or deleteObject when no new image is provided', async () => {
            const req = {
                params: { id: OFFER_ID },
                body: {
                    // no productOfferImage
                    productOfferImageUrl: OLD_ORIGINAL_URL,
                    productOfferThumbnailUrl: OLD_THUMB_URL,
                    productOfferDescription: 'Updated',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };

            await updateProductOffer(req, makeRes());

            expect(s3Mock.upload).not.toHaveBeenCalled();
            expect(s3Mock.deleteObject).not.toHaveBeenCalled();
        });

        test('skips thumbnail deletion when no previous thumbnailUrl exists', async () => {
            const req = {
                params: { id: OFFER_ID },
                body: {
                    productOfferImage: VALID_IMAGE,
                    productOfferImageUrl: OLD_ORIGINAL_URL,
                    // no productOfferThumbnailUrl (legacy offer without thumbnail)
                    productOfferDescription: 'Updated',
                    productOfferStatus: 'Active',
                    cashback: 5,
                    redeemPoints: 10,
                    price: VALID_PRICE,
                }
            };

            await updateProductOffer(req, makeRes());

            // deleteObject should only have been called once (for the original), not for thumbnail
            const deleteKeys = s3Mock.deleteObject.mock.calls.map(call => call[0].Key);
            expect(deleteKeys).not.toContain(`${OFFER_ID}_thumbnail.png`);
            // uploads still happen for both original and new thumbnail
            expect(s3Mock.upload).toHaveBeenCalledTimes(2);
        });
    });
});
