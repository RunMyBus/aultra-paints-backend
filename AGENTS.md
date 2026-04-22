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
