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

- `GET  /api/state` – settings, recurring costs and the last six months
- `POST /api/expense` – `{text}` to parse with Claude, or `{expense}` for a manual entry
- `PUT/DELETE /api/expense` – edit or remove
- `POST/DELETE /api/recurring`, `PUT /api/settings`
- `POST /api/analyze` – streams the AI review as plain text
- `GET  /siri?key=…&by=Rudy&text=…` – used by the Siri shortcut, replies with one sentence

All routes require the household key (`x-ledger-key` header or `key` query parameter).

