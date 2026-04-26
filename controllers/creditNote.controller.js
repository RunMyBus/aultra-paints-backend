const CreditNote = require('../models/CreditNote');
const TransactionLedger = require('../models/TransactionLedger');
const User = require('../models/User');
const Sequence = require('../models/sequence.model');
const { generateLedgerCode } = require('../services/transactionLedgerService');
const { generateCreditNoteIssuancePDF } = require('../utils/pdfGenerator');
const logger = require('../utils/logger');

const CREDIT_NOTE_MAX_AMOUNT = parseInt(process.env.CREDIT_NOTE_MAX_AMOUNT || '100000', 10);

async function generateCreditNoteNumber() {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `creditNote-${yyyymm}`;

    const seq = await Sequence.findOneAndUpdate(
        { name: key },
        { $inc: { value: 1 }, $set: { date: yyyymm } },
        { new: true, upsert: true }
    );

    return `CN-${yyyymm}-${String(seq.value).padStart(4, '0')}`;
}

// POST /creditNotes/issue
exports.issueCreditNote = async (req, res) => {
    const { userId, balanceType, amount, narration } = req.body;

    // Input validation
    if (!userId) {
        return res.status(400).json({ code: 'MISSING_FIELD', message: 'userId is required' });
    }
    if (!['rewardPoints', 'cash'].includes(balanceType)) {
        return res.status(400).json({ code: 'INVALID_BALANCE_TYPE', message: 'balanceType must be rewardPoints or cash' });
    }
    const parsedAmount = parseInt(amount, 10);
    if (!Number.isInteger(parsedAmount) || parsedAmount < 1) {
        return res.status(400).json({ code: 'INVALID_AMOUNT', message: 'amount must be a positive integer' });
    }
    if (parsedAmount > CREDIT_NOTE_MAX_AMOUNT) {
        return res.status(400).json({ code: 'AMOUNT_EXCEEDS_CAP', message: `amount cannot exceed ${CREDIT_NOTE_MAX_AMOUNT}` });
    }

    try {
        // Atomic debit: only succeeds if the dealer has sufficient balance
        const updatedUser = await User.findOneAndUpdate(
            { _id: userId, accountType: 'Dealer', [balanceType]: { $gte: parsedAmount } },
            { $inc: { [balanceType]: -parsedAmount } },
            { new: true }
        );

        if (!updatedUser) {
            // Either user not found, not a Dealer, or insufficient balance
            const dealer = await User.findOne({ _id: userId, accountType: 'Dealer' });
            if (!dealer) {
                return res.status(400).json({ code: 'DEALER_NOT_FOUND', message: 'Dealer not found' });
            }
            return res.status(400).json({ code: 'INSUFFICIENT_BALANCE', message: `Insufficient ${balanceType} balance` });
        }

        const creditNoteNumber = await generateCreditNoteNumber();

        const creditNote = await CreditNote.create({
            creditNoteNumber,
            userId,
            balanceType,
            amount: parsedAmount,
            narration: narration || undefined,
            status: 'issued',
        });

        // Write ledger debit row
        let ledgerRow;
        try {
            const uniqueCode = await generateLedgerCode(userId);
            const ledgerData = {
                narration: `Credit Note ${creditNoteNumber} issued`,
                userId,
                creditNoteId: creditNote._id.toString(),
                uniqueCode: uniqueCode || `CN_${creditNoteNumber}`,
            };

            if (balanceType === 'rewardPoints') {
                ledgerData.pointsCredited = `- ${parsedAmount}`;
                ledgerData.pointsBalance = updatedUser.rewardPoints;
            } else {
                ledgerData.cashReward = -parsedAmount;
                ledgerData.cashBalance = updatedUser.cash;
            }

            ledgerRow = await TransactionLedger.create(ledgerData);
            await CreditNote.findByIdAndUpdate(creditNote._id, { ledgerId: ledgerRow._id.toString() });
        } catch (ledgerErr) {
            // Log loudly — balance already debited; ops must reconcile manually
            logger.error('CRITICAL: Credit note ledger row failed after balance debit', {
                creditNoteNumber,
                userId,
                balanceType,
                amount: parsedAmount,
                error: ledgerErr.message,
            });
        }

        return res.status(201).json({
            creditNote: {
                creditNoteNumber: creditNote.creditNoteNumber,
                balanceType: creditNote.balanceType,
                amount: creditNote.amount,
                narration: creditNote.narration,
                status: creditNote.status,
                createdAt: creditNote.createdAt,
            },
            balanceAfter: {
                rewardPoints: updatedUser.rewardPoints,
                cash: updatedUser.cash,
            },
        });
    } catch (error) {
        logger.error('issueCreditNote error', { error: error.message });
        return res.status(500).json({ message: 'Failed to issue credit note' });
    }
};

// POST /creditNotes/list
exports.listCreditNotes = async (req, res) => {
    const page = parseInt(req.body.page) || 1;
    const limit = parseInt(req.body.limit) || 10;
    const skip = (page - 1) * limit;

    try {
        const query = {};
        if (req.body.userId)      query.userId = req.body.userId;
        if (req.body.balanceType) query.balanceType = req.body.balanceType;
        if (req.body.status)      query.status = req.body.status;

        if (req.body.dateFrom || req.body.dateTo) {
            query.createdAt = {};
            if (req.body.dateFrom) query.createdAt.$gte = new Date(req.body.dateFrom + 'T00:00:00.000Z');
            if (req.body.dateTo)   query.createdAt.$lte = new Date(req.body.dateTo   + 'T23:59:59.999Z');
        }

        const [creditNotes, total] = await Promise.all([
            CreditNote.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            CreditNote.countDocuments(query),
        ]);

        // Attach dealer name
        const userIds = [...new Set(creditNotes.map(cn => cn.userId))];
        const dealers = await User.find({ _id: { $in: userIds } }, 'name mobile').lean();
        const dealerMap = Object.fromEntries(dealers.map(d => [d._id.toString(), d]));

        const enriched = creditNotes.map(cn => ({
            ...cn,
            dealerName:   dealerMap[cn.userId]?.name   || '-',
            dealerMobile: dealerMap[cn.userId]?.mobile || '-',
        }));

        return res.json({
            creditNotes: enriched,
            pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
        });
    } catch (error) {
        logger.error('listCreditNotes error', { error: error.message });
        return res.status(500).json({ message: 'Failed to fetch credit notes' });
    }
};

// GET /creditNotes/pdf/:creditNoteNumber
exports.downloadCreditNotePDF = async (req, res) => {
    try {
        const creditNote = await CreditNote.findOne({ creditNoteNumber: req.params.creditNoteNumber }).lean();
        if (!creditNote) {
            return res.status(404).json({ message: 'Credit note not found' });
        }

        const dealer = await User.findById(creditNote.userId, 'name').lean();
        const dealerName = dealer?.name || '';

        const pdfBuffer = await generateCreditNoteIssuancePDF(creditNote, dealerName);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="CreditNote-${creditNote.creditNoteNumber}.pdf"`);
        res.end(pdfBuffer);
    } catch (error) {
        logger.error('downloadCreditNotePDF error', { error: error.message });
        return res.status(500).json({ message: 'Failed to generate PDF' });
    }
};
