const express = require('express');
const router = express.Router();
const passport = require('../middleware/passport');
const { requireRole, ADMIN } = require('../middleware/authorize');
const { issueCreditNote, listCreditNotes, downloadCreditNotePDF } = require('../controllers/creditNote.controller');

router.use(passport.authenticate('jwt', { session: false }));
router.use(requireRole(ADMIN));

router.post('/issue', issueCreditNote);
router.post('/list',  listCreditNotes);
router.get('/pdf/:creditNoteNumber', downloadCreditNotePDF);

module.exports = router;
