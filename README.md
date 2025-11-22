# Aultra Paints Backend

Node.js/Express service that powers authentication, orders, rewards, and transaction flows for the Aultra Paints platform. The API exposes REST endpoints, scheduled jobs, and messaging utilities that integrate with MongoDB, AWS, CashFree, and BulkPe services.

## Tech Stack
- **Runtime:** Node.js 18+, Express 4, Nodemon for local reloads
- **Data & Queueing:** MongoDB via Mongoose, optional MySQL helpers, AWS S3 for uploads
- **Auth & Security:** Passport strategies (JWT, bearer, local), Helmet, CORS allow-list
- **Testing:** Jest unit/integration suites with watch mode and manual mocks

## Project Layout
```
app.js                 # Entry point that loads config/express and DB connectors
config/                # Express configuration, AWS helpers, shared middleware
controllers/, routes/  # HTTP handlers organized by feature
services/, models/     # Business logic and data access abstractions
crons/, mongoscripts/  # Scheduled jobs and migration/maintenance scripts
assets/, templates/, redeem.html  # Static assets (emails, exports, landing pages)
tests/                 # Jest specs mirroring the feature folder structure
postman/               # Collections for manual API verification
```

## Getting Started
1. Install dependencies: `npm install`
2. Copy `.env_template` to `.env` and fill in database credentials, AWS buckets, SMS keys, and payment gateway flags.
3. Ensure MongoDB is reachable (default `mongodb://127.0.0.1:27017/aultrapaints`) and that any external services referenced in `.env` are accessible.

## Available Scripts
- `npm start` — runs `nodemon server` for local development; watches `app.js` and routes for changes.
- `npm test` — executes all Jest suites once.
- `npm run test:watch` — re-runs affected suites on change.
- `npm run build` — placeholder hook (extend if you add transpilation or asset bundling).

## Environment Variables
Key settings live in `.env`:
- `APP_RUNNING_PORT`, `NODE_ENV`, `jwt_secret`, `secretKey`
- Database: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_URL`
- Integrations: AWS (`AWS_ACCESS_KEY_Id`, `AWS_SECRETACCESSKEY`, bucket names), CashFree / BulkPe IDs, SMS provider credentials
- Feature toggles: `RUN_SCHEDULER_JOB`, `ACTIVATE_CASHFREE`, `ACTIVATE_BULKPE_PG`
Update PRs with any new variables so deployment environments stay in sync.

## Testing & Quality
- Place specs in `tests/<feature>/<subject>.test.js` matching the module you exercise.
- Mock external services (AWS, CashFree, SMS) with Jest manual mocks for deterministic runs.
- Target ~80% coverage on new code paths and include sad-path assertions for controllers/services.

## Deployment Notes
- Production instances typically run behind PM2; ensure `NODE_ENV=production` and the necessary env vars are set.
- Keep the `config/express.js` CORS allow-list updated when onboarding new client domains.
- Background jobs (`crons/`) can be toggled by `RUN_SCHEDULER_JOB`; disable when deploying stateless worker nodes.

## Troubleshooting
- **Port already in use:** adjust `APP_RUNNING_PORT` in `.env`.
- **CORS errors:** confirm the requesting origin exists in `allowedOrigins` within `config/express.js`.
- **Auth failures:** verify JWT secret alignment between the backend and any issuing services.
