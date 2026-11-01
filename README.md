# Rudy & Aya Ledger

A shared household expense app for two iPhones. Installed to the home screen as a full-screen web app.

- **Add**: type or speak an expense ("45 groceries at Spinneys"). Claude turns it into amount, description, category and date.
- **Siri**: "Hey Siri, add to my expenses" → speak → saved, with Siri reading back the result (set up once per phone from Settings in the app).
- **Plan**: subscriptions, salaries and bills, monthly or yearly (yearly spread per month in all totals).
- **Insights**: monthly dashboard, budget, charts and an AI read of overspending with concrete suggestions.

## Hosting (Netlify)

Static site in `public/`, backend in `netlify/functions/` (Netlify Functions 2.0), data in Netlify Blobs (no setup).

Environment variables (Site configuration → Environment variables):

| Name | Purpose |
|---|---|
| `HOUSEHOLD_KEY` | The password both phones enter once. Also used by the Siri shortcut. Pick something long. |
| `ANTHROPIC_API_KEY` | Claude API key for parsing and analysis. |
| `PARSE_MODEL` | Optional. Default `claude-haiku-5-5`. |
| `ANALYSIS_MODEL` | Optional. Default `claude-sonnet-5-5`. |

Redeploy after changing variables.

## Endpoints

- `GET  /api/state` – settings, recurring costs, income, accounts (with reconciliation and card cycles), net-worth history, the month check and the last six months of expenses and movements
- `GET  /api/month?m=YYYY-MM` – one month's expenses and movements
- `POST /api/expense` – `{text}` to parse with Claude (a transfer in the note becomes a movement), or `{expense}` for a manual entry; `PUT`/`DELETE` to edit or remove; `POST /api/expenses/delete` for a batch
- `POST/DELETE /api/move` – transfers between accounts, income landed, refunds, adjustments
- `POST /api/account`, `DELETE /api/account`, `POST /api/account/confirm` (a balance reading), `POST /api/account/resolve` (explain a gap)
- `POST/DELETE /api/income`, `POST/DELETE /api/recurring`, `PUT /api/settings`
- `POST /api/analyze` – streams the AI review as plain text
- `GET|POST /siri?key=…&by=Rudy&text=…` – the Siri shortcut; replies with one sentence
- `POST /pay` – the Apple Pay "Transaction" automation (merchant, amount, card)
- `POST /sms` – the bank-alert "Message" automation (text); classifies the alert into an expense, cash withdrawal, salary, card payment or refund and applies the stated balance

All routes require the household key (`x-ledger-key` header or `key` query parameter).

## How balances stay linked

Every expense is paid from an account (said in the note, else the member's default, else cash in hand) and every transfer moves money between two accounts. Each account keeps a baseline (its last real reading from a bank alert or a typed balance); the expected balance is that baseline plus everything logged since. Bookings move the balance; a reading that agrees moves the baseline forward, one that disagrees shows a gap in Wealth until it is explained (a withdrawal, a forgotten expense, a fee) or accepted.
