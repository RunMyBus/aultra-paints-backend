# Repository Guidelines

This Express/Jest backend powers Aultra Paints services. Use the guidance below to ship changes that integrate smoothly with the existing modules and release flow.

## Project Structure & Module Organization
- `app.js` bootstraps the server, `config/express.js` wires middleware/CORS, and `database/` hosts Mongo connections.
- Request handling flows from `routes/` into `controllers/`, then into business logic under `services/` and persistence in `models/`.
- Background jobs and shared helpers live in `crons/`, `utils/`, `scripts/`, and `mongoscripts/`, while UI assets sit in `assets/`, `templates/`, and `redeem.html`.
- API contract artifacts are maintained in `postman/` (`AULTRA-PAINTS-LOCAL.postman_collection.json`, `Sales-Masters-API.json`).
- Jest specs stay under `tests/`, mirroring the feature directory they cover for quick traceability.

## Build, Test, and Development Commands
- `npm install` — install runtime and test dependencies.
- `npm start` — runs the repo start script (`nodemon server` in `package.json`); app bootstrap is in `app.js`. Ensure `.env` defines `APP_RUNNING_PORT`, database URIs, and third-party keys.
- `npm test` / `npm run test:watch` — execute Jest suites once or continuously; add `--coverage` before merging feature work.
- `npm run build` is a placeholder hook; extend it if you introduce transpilation or asset bundling.
- Script utilities (run manually with `node <script>`): `scripts/analyze-accounts.js`, `scripts/check-db-dealers.js`, `scripts/sync-accounts.js`, `scripts/update-dealer-salesexec.js`.

## Coding Style & Naming Conventions
- Follow the prevailing 4-space indentation, single quotes, terminating semicolons, and `const`/`let` usage shown in `config/express.js` and controllers.
- Module naming is mixed by legacy and newer modules (examples: `authController.js`, `focus8Order.service.js`, `productOffers.route.js`, `brandRoutes.js`); preserve existing file patterns per feature instead of renaming broadly.
- Prefer async/await, minimal side effects inside controllers, and Winston-powered logging over stray `console.log` calls.

## Testing Guidelines
- Create files as `tests/<feature>/<subject>.test.js` with clear `describe` blocks (e.g., `describe('Transaction Ledger', ...)`).
- Stub integrations (AWS, CashFree, Mongo, MySQL) using Jest mocks or lightweight fakes so suites run deterministically, and aim for ~80% statement coverage on new code.

## Commit & Pull Request Guidelines
- Match the repo history: concise PascalCase subjects such as `AddedDealerName` or `FixCashFreeWebhook`, optionally suffixed with ticket IDs.
- Each PR must call out the change summary, testing evidence (`npm test`, manual steps), impacted routes/endpoints, and screenshots for template edits; link Jira/GitHub items for traceability.
- Keep PRs focused, rebase often, and confirm Jest passes locally before requesting review.

## Security & Configuration Tips
- Configure secrets via `.env` (never commit it); document new variables in your PR description so ops can update their environments.
- Update the `config/express.js` CORS whitelist when onboarding new clients, and adjust `middleware/passport.js` for auth tweaks.
- Validate and sanitize user inputs at controllers/services, and favor parameterized queries or ORM helpers when touching raw SQL.

## Latest Scanned Code Changes (as of 2026-02-28)
- Added Focus8-related pricing/effective-date logic in `services/focus8Order.service.js` and `controllers/productCatlogController.js`.
- Credit note flow was updated across `controllers/transactionLedgerController.js`, `templates/creditNoteTemplate.html`, and `utils/pdfGenerator.js`.
- Reward constants were introduced in `config/rewardConstants.js` and wired into ledger/credit-note behavior.
- New operational scripts added under `scripts/` for account/dealer sync workflows:
  - `analyze-accounts.js`
  - `check-db-dealers.js`
  - `sync-accounts.js`
  - `update-dealer-salesexec.js`
- Postman assets were refreshed in `postman/AULTRA-PAINTS-LOCAL.postman_collection.json`.
## Cash redemption — DISABLED (as of 2026-04-26)
Points-to-INR cash payouts via Cashfree and BulkPe payment gateways have been retired. Live entry points are gone; record-keeping artifacts remain on disk for historical queries.

- **Disabled routes** (every method/path under these returns HTTP 410 Gone with `{ success:false, code:'CASH_REDEMPTION_DISABLED', message:'…' }`):
  - `routes/cashFreeRoutes.js` mounted at `/cashFree/*`
  - `routes/bulkPeRoutes.js` mounted at `/bulkPe/*`
  - Both files collapsed to a single `router.all('/*', …)` that logs the hit (`utils/logger`) and returns the disabled payload.
- **Disabled cron**: the `crons/UpdatePendingCashFreeTransfers.js` registration was removed from `config/express.js` (the require line is commented out). The cron file remains on disk for history but no longer runs.
- **Preserved on disk** (no live entry points; kept for transactional record-keeping queries):
  - `controllers/cashFreeController.js`
  - `services/cashFreePaymentService.js`, `services/bulkPePaymentService.js`
  - `models/CashFreeTransaction.js`
  - `utils/Cashfree.js`
  - `crons/UpdatePendingCashFreeTransfers.js`
  - `mongoscripts/updateUserRedemptions.js`
- **Unaffected**: `routes/transfer.route.js` (`/transfer/toDealer`) is points-to-points only and is the recommended replacement path.

When changing related code, treat the gateway integrations as read-only history. Do not re-mount the disabled routes or re-register the cron without an explicit product decision.

## Coupon Redeem Flow (as of 2026-04-26)
The QR-scan redemption (`POST /transaction/redeemPoints`, handler in `services/transactionService.js#redeemCouponPoints`) treats every coupon as having two **independent** reward tracks, each crediting a distinct balance on the User.

- **Coupon model** (`models/Transaction.js`, MongoDB collection `transactions`):
  - Points track: `redeemablePoints` (value), `pointsRedeemedBy` / `pointsRedeemedAt` (used flag).
  - Cash track:   `value`             (value), `cashRedeemedBy`   / `cashRedeemedAt`   (used flag).
- **User balances** (`models/User.js`):
  - `rewardPoints` — credited from `coupon.redeemablePoints`.
  - `cash`         — credited from `coupon.value`. (Existing field — used in `userController.js` "Cash Reward" displays and in `authController.js` user-info responses; do **not** introduce a parallel `cashReward` field.)
- **Per-track idempotency**: a scan credits only the tracks where the corresponding `*RedeemedBy` is still undefined, and marks only those fields. The previously-redeemed track is left untouched.
- **Reject only when both are used**: returns `404 { message: 'Coupon Redeemed already.' }` only if BOTH `pointsRedeemedBy` and `cashRedeemedBy` are already set on the coupon.
- **Atomic update**: a single `User.findOneAndUpdate({ $inc: { rewardPoints, cash } })` increments both balances; the `$inc` object only contains the keys for the tracks being credited on this scan.
- **Response payload**:
  ```
  { rewardPoints: <points just credited>, cashReward: <cash just credited>, couponCode }
  ```
  `rewardPoints` carries only the points-track credit (matches the historical meaning of the field). `cashReward` carries the cash-track credit. The two are independent — there is no aggregate.
- **Ledger** (`models/TransactionLedger`): one row per scan, carrying both tracks in their own fields. Each track's pair of fields is independently optional — a row that only credits one track sets only that track's pair (the other pair is undefined).
  - `pointsCredited` — points credited / debited on this row (string preserves the legacy `'+ NNN'` / `'- NNN'` formatting used by credit-note PDFs; renamed from `amount` on 2026-04-26)
  - `pointsBalance`  — `User.rewardPoints` after this row's effect (renamed from `balance` on 2026-04-26; `required: true` was relaxed on 2026-04-26 so cash-only rows don't have to fabricate a points snapshot)
  - `cashReward`     — cash credited on this row
  - `cashBalance`    — `User.cash` after this row's effect
  Readers should treat any undefined pair as "this row did not affect that track". Old rows pre-dating the rename were migrated to the new field names by `mongoscripts/rename_ledger_points_fields.js` (run before deploying the renamed code); old rows do not carry the cash fields.
- **Eligibility** is unchanged: only `accountType` ∈ `POINTS_REDEEM_ELIGIBLE_ACCOUNT_TYPES` (env-driven, defaults to `Dealer`) with a `dealerCode` that resolves in Focus8 may redeem.

When extending this flow, preserve the per-track shape: introduce a new track with its own `*RedeemedBy/At` pair on the coupon, its own balance field on the User, and add it to the same `if (allTracksRedeemed) → 404` guard rather than reusing one of the existing tracks.

