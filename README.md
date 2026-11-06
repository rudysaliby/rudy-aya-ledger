# Rudy & Aya Ledger

A shared household expense app for two iPhones. Installed to the home screen as a full-screen web app.

- **Add**: type or speak an expense ("45 groceries at Spinneys"). Claude turns it into amount, description, category and date.
- **Siri**: "Hey Siri, add to my expenses" → speak → saved, with Siri reading back the result (set up once per phone from Settings in the app).
- **Plan**: subscriptions, salaries and bills, monthly or yearly (yearly spread per month in all totals).
- **Fixed costs are counted once**: when a payment of something in Plan is logged as an expense (rent by hand, a subscription from a bank alert), it is recognised by name and amount, shown with a "fixed cost" badge, and counted as that fixed cost rather than as day-to-day spending. Tap an expense → "Counts as" to correct it.
- **Insights**: a dashboard for one month, several, or all time, for the household or one person at a time: what stands out, where the money went (donut), ranked categories against last month, income-to-left-over waterfall, spending over time, weekday pattern, who spent, and an AI read with concrete suggestions.

## Hosting (Cloudflare Workers)

- `src/worker.mjs` is the Worker: API routes, plus the app's files served from this repository (`src/static.mjs`).
- Data lives in one SQLite-backed Durable Object (`src/storage.mjs`), declared in `wrangler.toml`; nothing to create by hand.
- The app's files are not uploaded anywhere: the Worker reads `dist/assets.json` from the `main` branch every few minutes,
  fetches any file whose hash it does not hold yet, verifies it, stores it and serves it. So `npm run build` + push is the
  whole front-end deploy. `dist/worker.js` (the bundled server) is what gets uploaded when the server logic changes —
  through `npx wrangler deploy`, Workers Builds, or the Script Upload API.
- Local run: `npm install && npm run dev` with a `.dev.vars` file holding the variables below.

Variables and secrets (Worker → Settings → Variables and Secrets):

| Name | Purpose |
|---|---|
| `HOUSEHOLD_KEY` | Secret. The password both phones enter once; also used by the Siri, Apple Pay and bank-alert shortcuts. |
| `ANTHROPIC_API_KEY` | Secret. Claude API key for parsing and analysis. |
| `ASSET_REPO`, `ASSET_BRANCH` | Where the app files come from (`rudysaliby/rudy-aya-ledger`, `main`). |
| `PARSE_MODEL`, `ANALYSIS_MODEL` | Optional. Defaults `claude-haiku-5-5` and `claude-sonnet-5-5`. |
| `IMPORT_FROM` | Optional. On the first load of an empty store, copies everything from a previous address with the same key. |

Backup: `GET /api/export` (with the key) downloads every data document; `POST /api/import` with that file restores it.

## Endpoints

- `GET  /api/state` – settings, recurring costs, income, accounts (with reconciliation), net-worth history, the month check and the last six months of expenses and movements
- `GET  /api/month?m=YYYY-MM` – one month's expenses and movements
- `POST /api/expense` – `{text}` to parse with Claude (a transfer in the note becomes a movement), or `{expense}` for a manual entry; `PUT`/`DELETE` to edit or remove; `POST /api/expenses/delete` for a batch
- `POST/DELETE /api/move` – transfers between accounts, income landed, refunds, adjustments
- `POST /api/account`, `DELETE /api/account`, `POST /api/account/confirm` (a balance reading), `POST /api/account/resolve` (explain a gap)
- `POST/DELETE /api/income`, `POST/DELETE /api/recurring`, `PUT /api/settings`
- `POST /api/analyze` – streams the AI review as plain text
- `GET|POST /siri?key=…&by=Rudy&text=…` – the Siri shortcut; replies with one sentence
- `POST /pay` – the Apple Pay "Transaction" automation (merchant, amount, card)
- `POST /sms` – the bank-alert "Message" automation (text); classifies the alert into an expense, cash withdrawal, salary, card payment or refund and applies the stated balance

All routes require the household key (`x-ledger-key` header or `key` query parameter). `GET /api/health` is open and reports the platform and the import status.

## How balances stay linked

Every expense is paid from an account (said in the note, else the member's default, else cash in hand) and every transfer moves money between two accounts. Each account keeps a baseline (its last real reading from a bank alert or a typed balance); the expected balance is that baseline plus everything logged since. Bookings move the balance; a reading that agrees moves the baseline forward, one that disagrees shows a gap in Wealth until it is explained (a withdrawal, a forgotten expense, a fee) or accepted.
