jest.mock('../../models/ProductCategory');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

const mongoose = require('mongoose');
const ProductCategory = require('../../models/ProductCategory');
const {
    createProductCategory,
    getProductCategories,
    updateProductCategory,
    deleteProductCategory,
} = require('../../controllers/productCategoryController');

function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}

const CAT_ID   = new mongoose.Types.ObjectId();
const MOCK_CAT = { _id: CAT_ID, name: 'Interior', createdAt: new Date(), updatedAt: new Date() };

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// createProductCategory
// ─────────────────────────────────────────────────────────────────────────────
describe('createProductCategory', () => {
    test('201 with created category on success', async () => {
        ProductCategory.findOne.mockResolvedValue(null);
        const saveMock = jest.fn().mockResolvedValue(MOCK_CAT);
        ProductCategory.mockImplementation(() => ({ save: saveMock }));

        const req = { body: { name: 'Interior' } };
        const res = makeRes();

        await createProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const body = res.json.mock.calls[0][0];
        expect(body.message).toMatch(/created successfully/i);
    });

    test('400 when name is missing', async () => {
        const req = { body: {} };
        const res = makeRes();

        await createProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].message).toMatch(/required/i);
        expect(ProductCategory.findOne).not.toHaveBeenCalled();
    });

    test('400 when name is empty string', async () => {
        const req = { body: { name: '   ' } };
        const res = makeRes();

        await createProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 when a category with the same name already exists', async () => {
        ProductCategory.findOne.mockResolvedValue(MOCK_CAT);

        const req = { body: { name: 'Interior' } };
        const res = makeRes();

        await createProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].message).toMatch(/already exists/i);
    });

    test('name is trimmed before duplicate check and save', async () => {
        ProductCategory.findOne.mockResolvedValue(null);
        const saveMock = jest.fn().mockResolvedValue(MOCK_CAT);
        ProductCategory.mockImplementation(() => ({ save: saveMock }));

        const req = { body: { name: '  Interior  ' } };
        const res = makeRes();

        await createProductCategory(req, res);

        expect(ProductCategory.findOne).toHaveBeenCalledWith({ name: 'Interior' });
        // Constructor called with trimmed name
        expect(ProductCategory).toHaveBeenCalledWith({ name: 'Interior' });
    });

    test('500 on unexpected DB error', async () => {
        ProductCategory.findOne.mockRejectedValue(new Error('DB down'));

        const req = { body: { name: 'Interior' } };
        const res = makeRes();

        await createProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].message).toBe('Internal Server Error');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getProductCategories
// ─────────────────────────────────────────────────────────────────────────────
describe('getProductCategories', () => {
    const MOCK_LIST = [
        { _id: new mongoose.Types.ObjectId(), name: 'Exterior' },
        { _id: new mongoose.Types.ObjectId(), name: 'Interior' },
    ];

    test('200 with data array on success', async () => {
        ProductCategory.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(MOCK_LIST) });

        const req = {};
        const res = makeRes();

        await getProductCategories(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const body = res.json.mock.calls[0][0];
        expect(body.data).toHaveLength(2);
    });

    test('results are sorted by name ascending', async () => {
        const sortMock = jest.fn().mockResolvedValue(MOCK_LIST);
        ProductCategory.find.mockReturnValue({ sort: sortMock });

        await getProductCategories({}, makeRes());

        expect(sortMock).toHaveBeenCalledWith({ name: 1 });
    });

    test('200 with empty array when no categories exist', async () => {
        ProductCategory.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

        const res = makeRes();
        await getProductCategories({}, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0].data).toHaveLength(0);
    });

    test('500 on DB error', async () => {
        ProductCategory.find.mockImplementation(() => { throw new Error('DB error'); });

        const res = makeRes();
        await getProductCategories({}, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].message).toBe('Internal Server Error');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProductCategory
// ─────────────────────────────────────────────────────────────────────────────
describe('updateProductCategory', () => {
    test('200 with updated category on success', async () => {
        ProductCategory.findOne.mockResolvedValue(null);
        ProductCategory.findByIdAndUpdate.mockResolvedValue({ ...MOCK_CAT, name: 'Exterior' });

        const req = { params: { id: CAT_ID.toString() }, body: { name: 'Exterior' } };
        const res = makeRes();

        await updateProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0].message).toMatch(/updated successfully/i);
    });

    test('400 when name is missing', async () => {
        const req = { params: { id: CAT_ID.toString() }, body: {} };
        const res = makeRes();

        await updateProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(ProductCategory.findOne).not.toHaveBeenCalled();
    });

    test('400 when another category already has the same name', async () => {
        ProductCategory.findOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId(), name: 'Exterior' });

        const req = { params: { id: CAT_ID.toString() }, body: { name: 'Exterior' } };
        const res = makeRes();

        await updateProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].message).toMatch(/already exists/i);
    });

    test('duplicate check excludes the current document by _id', async () => {
        ProductCategory.findOne.mockResolvedValue(null);
        ProductCategory.findByIdAndUpdate.mockResolvedValue(MOCK_CAT);

        const req = { params: { id: CAT_ID.toString() }, body: { name: 'Interior' } };
        await updateProductCategory(req, makeRes());

        expect(ProductCategory.findOne).toHaveBeenCalledWith({
            name: 'Interior',
            _id: { $ne: CAT_ID.toString() },
        });
    });

    test('404 when category id does not exist', async () => {
        ProductCategory.findOne.mockResolvedValue(null);
        ProductCategory.findByIdAndUpdate.mockResolvedValue(null);

        const req = { params: { id: CAT_ID.toString() }, body: { name: 'New Name' } };
        const res = makeRes();

        await updateProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json.mock.calls[0][0].message).toMatch(/not found/i);
    });

    test('500 on DB error', async () => {
        ProductCategory.findOne.mockRejectedValue(new Error('DB error'));

        const req = { params: { id: CAT_ID.toString() }, body: { name: 'Interior' } };
        const res = makeRes();

        await updateProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteProductCategory
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteProductCategory', () => {
    test('200 with success message when category is deleted', async () => {
        ProductCategory.findByIdAndDelete.mockResolvedValue(MOCK_CAT);

        const req = { params: { id: CAT_ID.toString() } };
        const res = makeRes();

        await deleteProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0].message).toMatch(/deleted successfully/i);
    });

    test('deletes by the id from req.params', async () => {
        ProductCategory.findByIdAndDelete.mockResolvedValue(MOCK_CAT);

        const req = { params: { id: CAT_ID.toString() } };
        await deleteProductCategory(req, makeRes());

        expect(ProductCategory.findByIdAndDelete).toHaveBeenCalledWith(CAT_ID.toString());
    });

    test('404 when category does not exist', async () => {
        ProductCategory.findByIdAndDelete.mockResolvedValue(null);

        const req = { params: { id: CAT_ID.toString() } };
        const res = makeRes();

        await deleteProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json.mock.calls[0][0].message).toMatch(/not found/i);
    });

    test('500 on DB error', async () => {
        ProductCategory.findByIdAndDelete.mockRejectedValue(new Error('DB error'));

        const req = { params: { id: CAT_ID.toString() } };
        const res = makeRes();

        await deleteProductCategory(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });
});
