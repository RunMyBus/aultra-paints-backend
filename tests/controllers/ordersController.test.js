// config is referenced at module level inside ordersController (e.g. GST_PERCENTAGE)
global.config = process.env;

const ordersController = require('../../controllers/ordersController');
const orderModel = require('../../models/Order');
const userModel = require('../../models/User');
const productOffersModel = require('../../models/productOffers.model');
const focus8Service = require('../../services/focus8Order.service');

jest.mock('../../models/Order');
jest.mock('../../models/User');
jest.mock('../../models/productOffers.model');
jest.mock('../../services/focus8Order.service');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

// Suppress puppeteer / handlebars imports pulled in by the controller
jest.mock('../../models/InvoiceTemplate', () => ({ findOne: jest.fn() }));
jest.mock('handlebars', () => ({ compile: jest.fn() }));
jest.mock('puppeteer', () => ({}));

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

const DEALER_ID = '64f000000000000000000001';
const SE_ID     = '64f000000000000000000002';
const SUPER_ID  = '64f000000000000000000003';

const dealerUser = {
    _id: { toString: () => DEALER_ID },
    accountType: 'Dealer',
    mobile: '9000000001',
    name: 'Test Dealer',
};

const seUser = {
    _id: { toString: () => SE_ID },
    accountType: 'SalesExecutive',
    mobile: '9000000002',
    name: 'Test SE',
};

const superUser = {
    _id: { toString: () => SUPER_ID },
    accountType: 'SuperUser',
    mobile: '9000000003',
    name: 'Super User',
};

function baseItems() {
    return [
        {
            _id: '64f100000000000000000001',
            productOfferDescription: 'Paint 1L',
            productPrice: 100,
            quantity: 2,
            volume: '1L',
            focusProductId: 501,
            focusUnitId: 1,
        },
    ];
}

// ═══════════════════════════════════════════════════════════════════════════
// createOrder
// ═══════════════════════════════════════════════════════════════════════════

describe('createOrder', () => {
    let res;

    // Default offer returned by productOffersModel.find().select() for baseItems()
    // price 100 @ volume '1L' → server-computed total = 2 × 100 = 200
    const BASE_OFFER = {
        _id: { toString: () => '64f100000000000000000001' },
        focusProductId: 501,
        focusUnitId: 1,
        focusProductMapping: [],
        productOfferDescription: 'Paint 1L',
        price: [{ volume: '1L', price: 100 }],
        offerAvailable: true,
    };

    function wireOfferFind(offers = [BASE_OFFER]) {
        productOffersModel.find = jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue(offers),
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        res = makeRes();
        process.env.GST_PERCENTAGE = '5';

        // Default: getNextOrderId returns ORD01
        orderModel.findOne = jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            }),
        });

        const savedOrder = { save: jest.fn().mockResolvedValue(true), focusSyncStatus: 'PENDING' };
        orderModel.mockImplementation(() => savedOrder);

        // Wire the default offer so the price-derivation + focus-ID resolution
        // path succeeds for all tests using baseItems() unless overridden.
        wireOfferFind();
    });

    // ── role validation ──────────────────────────────────────────────────────

    test('rejects non-Dealer/SalesExecutive account types', async () => {
        const req = { user: superUser, body: { items: baseItems(), totalPrice: 200 } };
        await ordersController.createOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    test('requires dealerId when SalesExecutive places order', async () => {
        const req = { user: seUser, body: { items: baseItems(), totalPrice: 200 } };
        await ordersController.createOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Dealer id is required'),
        }));
    });

    test('rejects empty items array', async () => {
        const req = { user: dealerUser, body: { items: [], totalPrice: 0 } };
        await ordersController.createOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: 'No items provided for order.',
        }));
    });

    test('rejects missing items field', async () => {
        const req = { user: dealerUser, body: { totalPrice: 200 } };
        await ordersController.createOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    // ── price validation ─────────────────────────────────────────────────────

    test('rejects order when totalPrice mismatches item sum', async () => {
        const req = {
            user: dealerUser,
            body: { items: baseItems(), totalPrice: 999 }, // should be 200
        };
        await ordersController.createOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Price mismatch'),
        }));
    });

    // ── focus product mapping ────────────────────────────────────────────────

    test('returns 400 when offer has no price configured for the requested volume', async () => {
        const items = [
            {
                _id: '64f100000000000000000002',
                productOfferDescription: 'Unmapped Paint',
                productPrice: 100,
                quantity: 1,
                volume: '1L',
            },
        ];
        // Offer exists but has no price entries — server rejects the order.
        productOffersModel.find = jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue([
                {
                    _id: { toString: () => '64f100000000000000000002' },
                    focusProductId: null,
                    focusUnitId: null,
                    focusProductMapping: [],
                    productOfferDescription: 'Unmapped Paint',
                    price: [], // no price entries
                },
            ]),
        });

        const req = { user: dealerUser, body: { items, totalPrice: 100 } };
        await ordersController.createOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('No price configured'),
        }));
    });

    test('uses volume-specific mapping when present', async () => {
        const items = [
            {
                _id: '64f100000000000000000003',
                productOfferDescription: 'Volume Paint',
                productPrice: 100,
                quantity: 1,
                volume: '5L',
                // no focusProductId / focusUnitId
            },
        ];
        productOffersModel.find = jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue([
                {
                    _id: { toString: () => '64f100000000000000000003' },
                    focusProductId: null,
                    focusUnitId: null,
                    focusProductMapping: [
                        { volume: '5L', focusProductId: 999, focusUnitId: 2 },
                    ],
                    productOfferDescription: 'Volume Paint',
                    price: [{ volume: '5L', price: 100 }],
                    offerAvailable: true,
                },
            ]),
        });

        const savedOrder = { save: jest.fn().mockResolvedValue(true) };
        orderModel.mockImplementation(() => savedOrder);
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);

        const req = { user: dealerUser, body: { items, totalPrice: 100 } };
        await ordersController.createOrder(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.order.items[0].focusProductId).toBe(999);
        expect(payload.order.items[0].focusUnitId).toBe(2);
    });

    // ── dealer order ─────────────────────────────────────────────────────────

    test('creates PENDING order for Dealer', async () => {
        const savedOrder = { save: jest.fn().mockResolvedValue(true) };
        orderModel.mockImplementation(() => savedOrder);

        const req = { user: dealerUser, body: { items: baseItems(), totalPrice: 200 } };
        await ordersController.createOrder(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.success).toBe(true);
        expect(payload.order.status).toBe('PENDING');
        expect(payload.order.isVerified).toBe(false);
        expect(focus8Service.pushOrderToFocus8).not.toHaveBeenCalled();
    });

    test('calculates GST correctly for Dealer order', async () => {
        process.env.GST_PERCENTAGE = '18';
        const savedOrder = { save: jest.fn().mockResolvedValue(true) };
        orderModel.mockImplementation(() => savedOrder);

        const req = { user: dealerUser, body: { items: baseItems(), totalPrice: 200 } };
        await ordersController.createOrder(req, res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.order.gstPrice).toBe(36); // 18% of 200
        expect(payload.order.finalPrice).toBe(236);
        expect(payload.order.gstPercentage).toBe(18);
    });

    // ── sales executive order ────────────────────────────────────────────────

    test('creates VERIFIED order for SalesExecutive and triggers Focus8 push', async () => {
        const savedOrder = { save: jest.fn().mockResolvedValue(true), focusSyncStatus: 'PENDING' };
        orderModel.mockImplementation(() => savedOrder);
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);
        // Use .mockResolvedValue on the auto-mock — reassignment won't work for destructured imports
        focus8Service.pushOrderToFocus8.mockResolvedValue({
            success: true,
            voucherNo: 'SO-001',
            focus8Response: { id: 1 },
        });

        const req = {
            user: seUser,
            body: { items: baseItems(), totalPrice: 200, dealerId: DEALER_ID, entityId: 'E1', warehouseId: 'W1', branchId: 'B1' },
        };
        await ordersController.createOrder(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.order.status).toBe('VERIFIED');
        expect(payload.order.isVerified).toBe(true);
        expect(payload.message).toContain('verified successfully');

        // pushOrderToFocus8 is called synchronously within createOrder before the response
        expect(focus8Service.pushOrderToFocus8).toHaveBeenCalledTimes(1);
    });

    test('marks focusSyncStatus FAILED via updateOne when Focus8 push fails for SE order', async () => {
        const savedOrder = { save: jest.fn().mockResolvedValue(true), focusSyncStatus: 'PENDING' };
        orderModel.mockImplementation(() => savedOrder);
        orderModel.updateOne = jest.fn().mockResolvedValue({});
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);
        focus8Service.pushOrderToFocus8.mockRejectedValue(new Error('Focus8 down'));

        const req = {
            user: seUser,
            body: { items: baseItems(), totalPrice: 200, dealerId: DEALER_ID, entityId: 'E1', warehouseId: 'W1', branchId: 'B1' },
        };
        await ordersController.createOrder(req, res);

        // Response should still succeed immediately
        expect(res.status).toHaveBeenCalledWith(200);

        // Flush microtask queue so the async runFocusSync catch block completes
        await new Promise(resolve => setImmediate(resolve));
        expect(orderModel.updateOne).toHaveBeenCalledWith(
            expect.any(Object),
            { $set: expect.objectContaining({ focusSyncStatus: 'FAILED' }) }
        );
    });

    test('generates sequential orderId (ORD01 → ORD02)', async () => {
        // Simulate existing order ORD01
        orderModel.findOne = jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({ orderId: 'ORD01' }),
            }),
        });
        const savedOrder = { save: jest.fn().mockResolvedValue(true) };
        orderModel.mockImplementation(() => savedOrder);

        const req = { user: dealerUser, body: { items: baseItems(), totalPrice: 200 } };
        await ordersController.createOrder(req, res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.order.orderId).toBe('ORD02');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// getOrders
// ═══════════════════════════════════════════════════════════════════════════

describe('getOrders', () => {
    let res;

    const mockOrders = [
        { orderId: 'ORD01', totalPrice: 200, status: 'PENDING' },
        { orderId: 'ORD02', totalPrice: 300, status: 'VERIFIED' },
    ];

    function buildOrderQuery() {
        return {
            populate: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            skip: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue(mockOrders),
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        res = makeRes();
        focus8Service.getSOMobileAppOrders.mockResolvedValue([
            { MobileAppOrderId: 'ORD01', DocNo: 'SO-001' },
        ]);
    });

    // ── unknown role ─────────────────────────────────────────────────────────

    test('returns empty array for unrecognised account type', async () => {
        const req = {
            user: { accountType: 'Painter' },
            body: { page: 1, limit: 10 },
        };
        await ordersController.getOrders(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            orders: [], total: 0, pages: 0,
        }));
    });

    // ── SuperUser ────────────────────────────────────────────────────────────

    test('SuperUser sees all orders with Focus8 enrichment', async () => {
        orderModel.countDocuments = jest.fn().mockResolvedValue(2);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: superUser, body: { page: 1, limit: 10 } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.total).toBe(2);
        expect(payload.orders[0].focusData).toEqual([{ MobileAppOrderId: 'ORD01', DocNo: 'SO-001' }]);
        expect(payload.orders[1].focusData).toEqual([]);
    });

    test('SuperUser pagination calculates pages correctly', async () => {
        orderModel.countDocuments = jest.fn().mockResolvedValue(25);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: superUser, body: { page: 2, limit: 10 } };
        await ordersController.getOrders(req, res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.pages).toBe(3); // ceil(25/10)
        expect(payload.currentPage).toBe(2);
    });

    // ── Dealer ───────────────────────────────────────────────────────────────

    test('Dealer sees only their own orders', async () => {
        orderModel.countDocuments = jest.fn().mockResolvedValue(1);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: dealerUser, body: { page: 1, limit: 10 } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        // query should include dealer's _id
        expect(orderModel.find).toHaveBeenCalledWith(
            expect.objectContaining({
                $or: expect.arrayContaining([
                    expect.objectContaining({ createdBy: dealerUser._id }),
                ]),
            })
        );
    });

    // ── SalesExecutive ───────────────────────────────────────────────────────

    test('SalesExecutive sees orders from mapped dealers', async () => {
        userModel.find = jest.fn()
            .mockReturnValueOnce({
                lean: jest.fn().mockResolvedValue([{ _id: DEALER_ID }]),
            });
        orderModel.countDocuments = jest.fn().mockResolvedValue(2);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: seUser, body: { page: 1, limit: 10 } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(userModel.find).toHaveBeenCalledWith(
            expect.objectContaining({ salesExecutive: seUser.mobile, accountType: 'Dealer' }),
            '_id'
        );
    });

    test('SalesExecutive with no mapped dealers returns empty orders', async () => {
        userModel.find = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
        });
        orderModel.countDocuments = jest.fn().mockResolvedValue(0);
        orderModel.find = jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            skip: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
        });

        const req = { user: seUser, body: { page: 1, limit: 10 } };
        await ordersController.getOrders(req, res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.orders).toHaveLength(0);
    });

    // ── status filter ────────────────────────────────────────────────────────

    test('SuperUser with status filter narrows the order query', async () => {
        orderModel.countDocuments = jest.fn().mockResolvedValue(1);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: superUser, body: { page: 1, limit: 10, status: 'PENDING' } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(orderModel.find).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'PENDING' })
        );
    });

    test('rejects unknown status with 400', async () => {
        const req = { user: superUser, body: { page: 1, limit: 10, status: 'WAT' } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            message: 'Invalid status',
        }));
    });

    // ── dealerCode filter ────────────────────────────────────────────────────

    test('SuperUser with dealerCode resolves dealer and filters by id', async () => {
        userModel.findOne = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({ _id: DEALER_ID }),
        });
        orderModel.countDocuments = jest.fn().mockResolvedValue(1);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: superUser, body: { page: 1, limit: 10, dealerCode: 'D0001' } };
        await ordersController.getOrders(req, res);

        expect(userModel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ dealerCode: 'D0001', accountType: 'Dealer' }),
            expect.anything()
        );
        expect(orderModel.find).toHaveBeenCalledWith(
            expect.objectContaining({
                $or: expect.arrayContaining([
                    expect.objectContaining({ createdBy: DEALER_ID }),
                    expect.objectContaining({ dealerId: DEALER_ID }),
                ]),
            })
        );
    });

    test('SuperUser with unknown dealerCode returns empty page', async () => {
        userModel.findOne = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(null),
        });

        const req = { user: superUser, body: { page: 1, limit: 10, dealerCode: 'NOPE' } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            orders: [], total: 0, pages: 0, currentPage: 1,
        }));
    });

    test('SalesExecutive with dealerCode of unmapped dealer returns empty page', async () => {
        // SE's mapped dealers: [DEALER_ID]; user typed code that resolves to a different id.
        userModel.find = jest.fn().mockReturnValueOnce({
            lean: jest.fn().mockResolvedValue([{ _id: DEALER_ID }]),
        });
        userModel.findOne = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({ _id: 'OTHER_DEALER_ID' }),
        });

        const req = { user: seUser, body: { page: 1, limit: 10, dealerCode: 'D9999' } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            orders: [], total: 0,
        }));
    });

    test('Dealer ignores dealerCode (own orders only)', async () => {
        orderModel.countDocuments = jest.fn().mockResolvedValue(1);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());

        const req = { user: dealerUser, body: { page: 1, limit: 10, dealerCode: 'D0001' } };
        await ordersController.getOrders(req, res);

        // userModel.findOne should NOT be called for Dealer
        expect(userModel.findOne).not.toHaveBeenCalled();
    });

    // ── Focus8 failure is non-fatal ──────────────────────────────────────────

    test('continues successfully even when Focus8 enrichment fails', async () => {
        orderModel.countDocuments = jest.fn().mockResolvedValue(1);
        orderModel.find = jest.fn().mockReturnValue(buildOrderQuery());
        focus8Service.getSOMobileAppOrders.mockRejectedValue(new Error('Focus8 down'));

        const req = { user: superUser, body: { page: 1, limit: 10 } };
        await ordersController.getOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        // focusData defaults to empty array when enrichment fails
        payload.orders.forEach(order => expect(order.focusData).toEqual([]));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// getOrderDealers
// ═══════════════════════════════════════════════════════════════════════════

describe('getOrderDealers', () => {
    let res;
    beforeEach(() => {
        jest.clearAllMocks();
        res = makeRes();
    });

    test('SuperUser receives all active dealers sorted by dealerCode', async () => {
        const dealers = [
            { _id: 'a', dealerCode: 'D0001', name: 'Alpha' },
            { _id: 'b', dealerCode: 'D0002', name: 'Beta' },
        ];
        userModel.find = jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(dealers),
            }),
        });
        const req = { user: superUser };
        await ordersController.getOrderDealers(req, res);
        expect(userModel.find).toHaveBeenCalledWith(
            { accountType: 'Dealer', status: 'active' },
            { _id: 1, dealerCode: 1, name: 1 }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, dealers });
    });

    test('SalesExecutive receives only mapped dealers', async () => {
        const dealers = [{ _id: 'a', dealerCode: 'D0001', name: 'Alpha' }];
        userModel.find = jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(dealers),
            }),
        });
        const req = { user: seUser };
        await ordersController.getOrderDealers(req, res);
        expect(userModel.find).toHaveBeenCalledWith(
            {
                accountType: 'Dealer',
                status: 'active',
                salesExecutive: seUser.mobile,
            },
            { _id: 1, dealerCode: 1, name: 1 }
        );
        expect(res.json).toHaveBeenCalledWith({ success: true, dealers });
    });

    test('Dealer is rejected with 403', async () => {
        const req = { user: dealerUser };
        await ordersController.getOrderDealers(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// getOrderDetails
// ═══════════════════════════════════════════════════════════════════════════

describe('getOrderDetails', () => {
    let res;

    const baseOrder = {
        orderId: 'ORD01',
        status: 'VERIFIED',
        createdAt: new Date(),
        focusSyncStatus: 'PENDING',
        focusOrderId: null,
        createdBy: { _id: { toString: () => DEALER_ID }, name: 'Test Dealer' },
        dealerId: null,
        items: [
            { focusProductId: 501, quantity: 2, productOfferDescription: 'Paint' },
        ],
    };

    function mockFindOne(order) {
        orderModel.findOne = jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue(order),
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        res = makeRes();
    });

    // ── not found ────────────────────────────────────────────────────────────

    test('returns 404 when order does not exist', async () => {
        mockFindOne(null);
        const req = { user: dealerUser, params: { orderId: 'ORD99' } };
        await ordersController.getOrderDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    // ── Dealer access control ────────────────────────────────────────────────

    test('Dealer can access their own order', async () => {
        mockFindOne({ ...baseOrder });
        const req = { user: dealerUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('Dealer gets 403 when accessing another dealer\'s order', async () => {
        const otherDealerOrder = {
            ...baseOrder,
            createdBy: { _id: { toString: () => '64faaaaaaaaaaaaaaaaaaaaa' } },
        };
        mockFindOne(otherDealerOrder);
        const req = { user: dealerUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Access denied' }));
    });

    test('Dealer can access order where dealerId matches their id', async () => {
        const orderWithDealerId = {
            ...baseOrder,
            createdBy: { _id: { toString: () => SE_ID } }, // created by SE
            dealerId: { _id: { toString: () => DEALER_ID } },  // but for this dealer
        };
        mockFindOne(orderWithDealerId);
        const req = { user: dealerUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    // ── SalesExecutive access control ────────────────────────────────────────

    test('SalesExecutive can access mapped dealer\'s order', async () => {
        mockFindOne({ ...baseOrder });
        userModel.find = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([{ _id: { toString: () => DEALER_ID } }]),
        });
        const req = { user: seUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('SalesExecutive gets 403 for unmapped dealer order', async () => {
        mockFindOne({ ...baseOrder }); // dealer ID = DEALER_ID
        userModel.find = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([{ _id: { toString: () => '64fbbbbbbbbbbbbbbbbbbbb' } }]),
        });
        const req = { user: seUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    // ── Dispatch status enrichment ───────────────────────────────────────────

    test('enriches items with DISPATCHED status when qty fully delivered', async () => {
        const syncedOrder = {
            ...baseOrder,
            focusSyncStatus: 'SUCCESS',
            focusOrderId: 'SO-001',
            items: [{ focusProductId: 501, quantity: 2, productOfferDescription: 'Paint' }],
        };
        mockFindOne(syncedOrder);

        focus8Service.getDCInvoiceForOrder.mockResolvedValue([
            { 'Item Name': 'Aultra Paint', Quantity: '2' },
        ]);
        focus8Service.getProductMaster.mockResolvedValue([
            { iMasterId: 501, sName: 'Aultra Paint' },
        ]);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue({});

        const req = { user: superUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const { order } = res.json.mock.calls[0][0];
        expect(order.items[0].dispatchStatus).toBe('DISPATCHED');
        expect(order.items[0].dispatchedQty).toBe(2);
        expect(order.status).toBe('DISPATCHED');
    });

    test('enriches items with IN-PARCEL status when qty partially delivered', async () => {
        const syncedOrder = {
            ...baseOrder,
            focusSyncStatus: 'SUCCESS',
            focusOrderId: 'SO-001',
            items: [{ focusProductId: 501, quantity: 5, productOfferDescription: 'Paint' }],
        };
        mockFindOne(syncedOrder);

        focus8Service.getDCInvoiceForOrder.mockResolvedValue([
            { 'Item Name': 'Aultra Paint', Quantity: '2' },
        ]);
        focus8Service.getProductMaster.mockResolvedValue([
            { iMasterId: 501, sName: 'Aultra Paint' },
        ]);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue({});

        const req = { user: superUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);

        const { order } = res.json.mock.calls[0][0];
        expect(order.items[0].dispatchStatus).toBe('IN-PARCEL');
        expect(order.status).toBe('IN-PARCEL');
    });

    test('persists derived status to DB when status changes', async () => {
        const syncedOrder = {
            ...baseOrder,
            status: 'VERIFIED',
            focusSyncStatus: 'SUCCESS',
            focusOrderId: 'SO-001',
            items: [{ focusProductId: 501, quantity: 2, productOfferDescription: 'Paint' }],
        };
        mockFindOne(syncedOrder);
        focus8Service.getDCInvoiceForOrder.mockResolvedValue([
            { 'Item Name': 'Aultra Paint', Quantity: '2' },
        ]);
        focus8Service.getProductMaster.mockResolvedValue([
            { iMasterId: 501, sName: 'Aultra Paint' },
        ]);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue({});

        const req = { user: superUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);

        expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
            { orderId: 'ORD01' },
            expect.objectContaining({ status: 'DISPATCHED' }),
            expect.any(Object)
        );
    });

    test('skips DC invoice fetch when focusSyncStatus is not SUCCESS', async () => {
        mockFindOne({ ...baseOrder, focusSyncStatus: 'FAILED' });

        const req = { user: superUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);

        expect(focus8Service.getDCInvoiceForOrder).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('continues successfully even when DC invoice fetch throws', async () => {
        const syncedOrder = {
            ...baseOrder,
            focusSyncStatus: 'SUCCESS',
            focusOrderId: 'SO-001',
        };
        mockFindOne(syncedOrder);
        focus8Service.getDCInvoiceForOrder.mockRejectedValue(new Error('Focus8 timeout'));
        focus8Service.getProductMaster.mockRejectedValue(new Error('timeout'));

        const req = { user: superUser, params: { orderId: 'ORD01' } };
        await ordersController.getOrderDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateOrderStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('updateOrderStatus', () => {
    let res;

    const pendingOrder = {
        _id: '64f200000000000000000001',
        orderId: 'ORD01',
        status: 'PENDING',
        createdBy: DEALER_ID,
        save: jest.fn().mockResolvedValue(true),
        focusSyncStatus: 'PENDING',
    };

    const updatedOrder = {
        ...pendingOrder,
        status: 'VERIFIED',
        isVerified: true,
        save: jest.fn().mockResolvedValue(true),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        res = makeRes();
    });

    // ── role check ───────────────────────────────────────────────────────────

    test('rejects non-SalesExecutive users with 403', async () => {
        const req = { user: dealerUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Only Sales Executives'),
        }));
    });

    test('rejects SuperUser with 403', async () => {
        const req = { user: superUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    // ── order not found / unmapped ───────────────────────────────────────────

    test('returns 404 when order is not found or not mapped to SE', async () => {
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(null);

        const req = { user: seUser, body: { orderId: 'ORD99', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    // ── invalid isVerified value ─────────────────────────────────────────────

    test('returns 400 for invalid isVerified value', async () => {
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(updatedOrder);

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 2 } };
        await ordersController.updateOrderStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Invalid action'),
        }));
    });

    // ── verify order ─────────────────────────────────────────────────────────

    test('verifies order and triggers Focus8 push', async () => {
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(updatedOrder);
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);
        focus8Service.pushOrderToFocus8.mockResolvedValue({
            success: true,
            voucherNo: 'SO-001',
            focus8Response: {},
        });

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.success).toBe(true);
        expect(payload.message).toContain('verified');
        expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
            { orderId: 'ORD01' },
            expect.objectContaining({ status: 'VERIFIED', isVerified: true }),
            expect.any(Object)
        );

        // pushOrderToFocus8 is called synchronously within updateOrderStatus before the response
        expect(focus8Service.pushOrderToFocus8).toHaveBeenCalledTimes(1);
    });

    test('persists focusSyncStatus SUCCESS via updateOne after successful Focus8 push', async () => {
        orderModel.updateOne = jest.fn().mockResolvedValue({});
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(updatedOrder);
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);
        focus8Service.pushOrderToFocus8.mockResolvedValue({
            success: true,
            voucherNo: 'SO-002',
            focus8Response: {},
        });

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);

        // Flush microtask queue so the async runFocusSync .then() completes
        await new Promise(resolve => setImmediate(resolve));

        expect(orderModel.updateOne).toHaveBeenCalledWith(
            expect.any(Object),
            { $set: expect.objectContaining({ focusSyncStatus: 'SUCCESS', focusOrderId: 'SO-002' }) }
        );
    });

    test('persists focusSyncStatus FAILED via updateOne when Focus8 push rejects', async () => {
        orderModel.updateOne = jest.fn().mockResolvedValue({});
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(updatedOrder);
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);
        focus8Service.pushOrderToFocus8.mockRejectedValue(new Error('Focus8 error'));

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);

        await new Promise(resolve => setImmediate(resolve));

        expect(orderModel.updateOne).toHaveBeenCalledWith(
            expect.any(Object),
            { $set: expect.objectContaining({ focusSyncStatus: 'FAILED' }) }
        );
    });

    test('persists focusSyncStatus FAILED via updateOne when Focus8 returns success:false', async () => {
        orderModel.updateOne = jest.fn().mockResolvedValue({});
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(updatedOrder);
        userModel.findById = jest.fn().mockResolvedValue(dealerUser);
        focus8Service.pushOrderToFocus8.mockResolvedValue({
            success: false,
            focus8Response: { error: 'Bad request' },
        });

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);

        await new Promise(resolve => setImmediate(resolve));

        expect(orderModel.updateOne).toHaveBeenCalledWith(
            expect.any(Object),
            { $set: expect.objectContaining({ focusSyncStatus: 'FAILED' }) }
        );
    });

    // ── reject order ─────────────────────────────────────────────────────────

    test('rejects order and does NOT push to Focus8', async () => {
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        const rejectedOrder = { ...pendingOrder, status: 'REJECTED', isRejected: true, save: jest.fn() };
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(rejectedOrder);

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 0 } };
        await ordersController.updateOrderStatus(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.message).toContain('rejected');
        expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
            { orderId: 'ORD01' },
            expect.objectContaining({ status: 'REJECTED', isRejected: true }),
            expect.any(Object)
        );
        expect(focus8Service.pushOrderToFocus8).not.toHaveBeenCalled();
    });

    // ── dealer not found edge case ───────────────────────────────────────────

    test('skips Focus8 push and logs error when dealer not found after verify', async () => {
        userModel.find = jest.fn().mockResolvedValue([{ _id: DEALER_ID }]);
        orderModel.findOne = jest.fn().mockResolvedValue(pendingOrder);
        orderModel.findOneAndUpdate = jest.fn().mockResolvedValue(updatedOrder);
        userModel.findById = jest.fn().mockResolvedValue(null); // dealer not found

        const req = { user: seUser, body: { orderId: 'ORD01', isVerified: 1 } };
        await ordersController.updateOrderStatus(req, res);

        // Should still return success
        expect(res.status).toHaveBeenCalledWith(200);
        expect(focus8Service.pushOrderToFocus8).not.toHaveBeenCalled();
    });
});
