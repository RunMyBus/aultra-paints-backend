// ─────────────────────────────────────────────────────────────────────────────
// Mocks — declared before any require() so Jest hoisting applies
// ─────────────────────────────────────────────────────────────────────────────
jest.mock('../../models/CreditNote');
jest.mock('../../models/TransactionLedger');
jest.mock('../../models/User');
jest.mock('../../models/sequence.model');
jest.mock('../../services/transactionLedgerService', () => ({
    generateLedgerCode: jest.fn().mockResolvedValue('DEALER01_260426_1'),
}));
jest.mock('../../utils/pdfGenerator', () => ({
    generateCreditNoteIssuancePDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-mock')),
}));
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

const mongoose = require('mongoose');
const CreditNote = require('../../models/CreditNote');
const TransactionLedger = require('../../models/TransactionLedger');
const User = require('../../models/User');
const Sequence = require('../../models/sequence.model');
const { generateLedgerCode } = require('../../services/transactionLedgerService');
const { generateCreditNoteIssuancePDF } = require('../../utils/pdfGenerator');
const logger = require('../../utils/logger');
const {
    issueCreditNote,
    listCreditNotes,
    downloadCreditNotePDF,
} = require('../../controllers/creditNote.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    res.end       = jest.fn();
    return res;
}

const DEALER_ID = new mongoose.Types.ObjectId().toString();

// A successfully debited user returned by findOneAndUpdate
const UPDATED_USER = { _id: DEALER_ID, rewardPoints: 4500, cash: 200 };

// A CreditNote document returned by CreditNote.create()
const CREATED_CN = {
    _id: new mongoose.Types.ObjectId(),
    creditNoteNumber: 'CN-202604-0001',
    balanceType: 'rewardPoints',
    amount: 500,
    narration: 'Q1 settlement',
    status: 'issued',
    createdAt: new Date('2026-04-26T10:00:00Z'),
};

const LEDGER_ROW = { _id: new mongoose.Types.ObjectId() };

// Wire up the happy-path mocks
function wireHappyPath({ balanceType = 'rewardPoints' } = {}) {
    User.findOneAndUpdate.mockResolvedValue(UPDATED_USER);
    Sequence.findOneAndUpdate.mockResolvedValue({ value: 1 });
    CreditNote.create.mockResolvedValue({ ...CREATED_CN, balanceType });
    CreditNote.findByIdAndUpdate.mockResolvedValue({});
    TransactionLedger.create.mockResolvedValue(LEDGER_ROW);
    generateLedgerCode.mockResolvedValue('DEALER01_260426_1');
}

// ─────────────────────────────────────────────────────────────────────────────
// issueCreditNote
// ─────────────────────────────────────────────────────────────────────────────
describe('issueCreditNote', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            body: {
                userId: DEALER_ID,
                balanceType: 'rewardPoints',
                amount: 500,
                narration: 'Q1 settlement',
            },
        };
        res = makeRes();
    });

    // ── Input validation ──────────────────────────────────────────────────────
    test('400 MISSING_FIELD when userId is empty', async () => {
        req.body.userId = '';
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'MISSING_FIELD' })
        );
    });

    test('400 INVALID_BALANCE_TYPE when balanceType is not rewardPoints or cash', async () => {
        req.body.balanceType = 'tokens';
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INVALID_BALANCE_TYPE' })
        );
    });

    test('400 INVALID_AMOUNT when amount is 0', async () => {
        req.body.amount = 0;
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INVALID_AMOUNT' })
        );
    });

    test('400 INVALID_AMOUNT when amount is negative', async () => {
        req.body.amount = -100;
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INVALID_AMOUNT' })
        );
    });

    test('400 AMOUNT_EXCEEDS_CAP when amount exceeds 100000', async () => {
        req.body.amount = 100001;
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'AMOUNT_EXCEEDS_CAP' })
        );
    });

    // ── Balance / dealer checks ───────────────────────────────────────────────
    test('400 DEALER_NOT_FOUND when dealer does not exist', async () => {
        User.findOneAndUpdate.mockResolvedValue(null); // atomic debit fails
        User.findOne.mockResolvedValue(null);           // dealer lookup fails
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'DEALER_NOT_FOUND' })
        );
    });

    test('400 INSUFFICIENT_BALANCE when dealer exists but balance is too low', async () => {
        User.findOneAndUpdate.mockResolvedValue(null);                          // atomic debit fails
        User.findOne.mockResolvedValue({ _id: DEALER_ID, rewardPoints: 100 }); // dealer exists
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' })
        );
    });

    // ── Happy paths ───────────────────────────────────────────────────────────
    test('201 on successful rewardPoints issuance — correct response shape', async () => {
        wireHappyPath({ balanceType: 'rewardPoints' });
        await issueCreditNote(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const body = res.json.mock.calls[0][0];
        expect(body.creditNote.balanceType).toBe('rewardPoints');
        expect(body.creditNote.amount).toBe(500);
        expect(body.creditNote.status).toBe('issued');
        expect(body.balanceAfter.rewardPoints).toBe(UPDATED_USER.rewardPoints);
    });

    test('201 on successful cash issuance — ledger row uses cashReward/cashBalance', async () => {
        req.body.balanceType = 'cash';
        req.body.amount = 200;
        wireHappyPath({ balanceType: 'cash' });

        await issueCreditNote(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const ledgerArg = TransactionLedger.create.mock.calls[0][0];
        expect(ledgerArg.cashReward).toBe(-200);
        expect(ledgerArg.cashBalance).toBe(UPDATED_USER.cash);
        expect(ledgerArg).not.toHaveProperty('pointsCredited');
    });

    test('rewardPoints ledger row has pointsCredited and pointsBalance, not cash fields', async () => {
        wireHappyPath({ balanceType: 'rewardPoints' });
        await issueCreditNote(req, res);

        const ledgerArg = TransactionLedger.create.mock.calls[0][0];
        expect(ledgerArg.pointsCredited).toBe('- 500');
        expect(ledgerArg.pointsBalance).toBe(UPDATED_USER.rewardPoints);
        expect(ledgerArg).not.toHaveProperty('cashReward');
    });

    test('debit uses atomic findOneAndUpdate with $gte balance guard', async () => {
        wireHappyPath();
        await issueCreditNote(req, res);

        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                accountType: 'Dealer',
                rewardPoints: { $gte: 500 },
            }),
            { $inc: { rewardPoints: -500 } },
            { new: true }
        );
    });

    test('201 still returned when ledger row creation fails (resilient)', async () => {
        wireHappyPath();
        TransactionLedger.create.mockRejectedValue(new Error('DB write failed'));

        await issueCreditNote(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('CRITICAL'),
            expect.any(Object)
        );
    });

    test('500 on unexpected error', async () => {
        User.findOneAndUpdate.mockRejectedValue(new Error('Connection lost'));
        await issueCreditNote(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Failed to issue credit note' })
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// listCreditNotes
// ─────────────────────────────────────────────────────────────────────────────
describe('listCreditNotes', () => {
    let req, res;
    const CN_ID = new mongoose.Types.ObjectId();
    const DEALER_OBJ_ID = new mongoose.Types.ObjectId();

    const MOCK_CNS = [
        {
            _id: CN_ID,
            creditNoteNumber: 'CN-202604-0001',
            userId: DEALER_OBJ_ID.toString(),
            balanceType: 'rewardPoints',
            amount: 500,
            status: 'issued',
            createdAt: new Date(),
        },
    ];
    const MOCK_DEALER = { _id: DEALER_OBJ_ID, name: 'Test Dealer', mobile: '9876500001' };

    function wireFindChain(docs = MOCK_CNS) {
        CreditNote.find.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                skip: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                        lean: jest.fn().mockResolvedValue(docs),
                    }),
                }),
            }),
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        req = { body: { page: 1, limit: 10 } };
        res = makeRes();
        wireFindChain();
        CreditNote.countDocuments.mockResolvedValue(1);
        User.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([MOCK_DEALER]) });
    });

    test('returns paginated list enriched with dealer name', async () => {
        await listCreditNotes(req, res);

        const body = res.json.mock.calls[0][0];
        expect(body.creditNotes).toHaveLength(1);
        expect(body.creditNotes[0].dealerName).toBe('Test Dealer');
        expect(body.creditNotes[0].dealerMobile).toBe('9876500001');
        expect(body.pagination.total).toBe(1);
        expect(body.pagination.currentPage).toBe(1);
    });

    test('applies userId filter when provided in body', async () => {
        req.body.userId = DEALER_OBJ_ID.toString();
        await listCreditNotes(req, res);

        const queryArg = CreditNote.find.mock.calls[0][0];
        expect(queryArg.userId).toBe(DEALER_OBJ_ID.toString());
    });

    test('applies dateFrom and dateTo as ISO boundaries', async () => {
        req.body.dateFrom = '2026-04-01';
        req.body.dateTo   = '2026-04-30';
        await listCreditNotes(req, res);

        const queryArg = CreditNote.find.mock.calls[0][0];
        expect(queryArg.createdAt.$gte).toEqual(new Date('2026-04-01T00:00:00.000Z'));
        expect(queryArg.createdAt.$lte).toEqual(new Date('2026-04-30T23:59:59.999Z'));
    });

    test('500 on database error', async () => {
        CreditNote.find.mockImplementation(() => { throw new Error('DB error'); });
        await listCreditNotes(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Failed to fetch credit notes' })
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// downloadCreditNotePDF
// ─────────────────────────────────────────────────────────────────────────────
describe('downloadCreditNotePDF', () => {
    let req, res;
    const MOCK_CN = {
        _id: new mongoose.Types.ObjectId(),
        creditNoteNumber: 'CN-202604-0001',
        userId: new mongoose.Types.ObjectId().toString(),
        balanceType: 'rewardPoints',
        amount: 500,
        status: 'issued',
        createdAt: new Date(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: { creditNoteNumber: 'CN-202604-0001' } };
        res = makeRes();
    });

    test('404 when credit note does not exist', async () => {
        CreditNote.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
        await downloadCreditNotePDF(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Credit note not found' })
        );
    });

    test('streams PDF buffer with correct headers', async () => {
        CreditNote.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(MOCK_CN) });
        User.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: 'Test Dealer' }) });

        await downloadCreditNotePDF(req, res);

        expect(generateCreditNoteIssuancePDF).toHaveBeenCalledWith(MOCK_CN, 'Test Dealer');
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
        expect(res.setHeader).toHaveBeenCalledWith(
            'Content-Disposition',
            expect.stringContaining('CN-202604-0001')
        );
        expect(res.end).toHaveBeenCalled();
    });

    test('500 on unexpected error', async () => {
        CreditNote.findOne.mockImplementation(() => { throw new Error('DB down'); });
        await downloadCreditNotePDF(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Failed to generate PDF' })
        );
    });
});
