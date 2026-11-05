// src/worker.mjs
import { DurableObject } from "cloudflare:workers";

// src/storage.mjs
var runtime = { env: null, docs: null };
function bindRuntime(r) {
  runtime = { env: r.env || null, docs: r.docs || null };
}
function envVar(name) {
  const e = runtime.env;
  if (e && e[name] != null && e[name] !== "") return String(e[name]);
  try {
    if (typeof process !== "undefined" && process.env && process.env[name]) return process.env[name];
  } catch (e2) {
  }
  return void 0;
}
function docs() {
  if (runtime.docs) return runtime.docs;
  const ns = runtime.env && runtime.env.LEDGER;
  if (!ns) throw new Error("Storage is not bound (LEDGER Durable Object missing).");
  return ns.get(ns.idFromName("main"));
}
function store() {
  return {
    async get(key, { type } = {}) {
      const r = await docs().get(key);
      if (!r) return null;
      return type === "json" ? JSON.parse(r.body) : r.body;
    },
    async getWithMetadata(key, { type } = {}) {
      const r = await docs().get(key);
      if (!r) return null;
      return { data: type === "json" ? JSON.parse(r.body) : r.body, etag: r.etag, metadata: {} };
    },
    async setJSON(key, data, opts = {}) {
      return docs().set(key, JSON.stringify(data), { onlyIfMatch: opts.onlyIfMatch || null, onlyIfNew: !!opts.onlyIfNew });
    },
    async list({ prefix = "" } = {}) {
      const keys = await docs().list(prefix);
      return { blobs: keys.map((key) => ({ key })) };
    },
    async delete(key) {
      await docs().delete(key);
    },
    async dump() {
      return docs().dump();
    },
    async load(entries) {
      return docs().load(entries);
    }
  };
}
var newEtag = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
function defineLedgerStore(DurableObject2) {
  return class LedgerStore extends DurableObject2 {
    constructor(ctx, env2) {
      super(ctx, env2);
      this.sql = ctx.storage.sql;
      this.sql.exec(`CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, body TEXT NOT NULL, etag TEXT NOT NULL, updated INTEGER NOT NULL)`);
    }
    get(key) {
      const r = this.sql.exec(`SELECT body, etag FROM docs WHERE key = ?`, key).toArray()[0];
      return r ? { body: r.body, etag: r.etag } : null;
    }
    set(key, body, opts = {}) {
      const cur = this.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = newEtag();
      this.sql.exec(`INSERT INTO docs (key, body, etag, updated) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, etag = excluded.etag, updated = excluded.updated`, key, body, etag, Date.now());
      return { modified: true, etag };
    }
    list(prefix) {
      const like = String(prefix).replace(/[\\%_]/g, (m) => "\\" + m) + "%";
      return this.sql.exec(`SELECT key FROM docs WHERE key LIKE ? ESCAPE '\\' ORDER BY key`, like).toArray().map((r) => r.key);
    }
    delete(key) {
      this.sql.exec(`DELETE FROM docs WHERE key = ?`, key);
    }
    dump() {
      return this.sql.exec(`SELECT key, body, updated FROM docs ORDER BY key`).toArray();
    }
    load(entries) {
      const run = () => {
        let n = 0;
        for (const e of entries) {
          this.set(e.key, e.body);
          n++;
        }
        return n;
      };
      return this.ctx.storage.transactionSync ? this.ctx.storage.transactionSync(run) : run();
    }
  };
}

// src/lib/ledger.mjs
var TAGS = ["Groceries", "Dining", "Coffee", "Transport", "Fuel", "Kids", "School", "Health", "Pharmacy", "Home", "Utilities", "Shopping", "Clothes", "Beauty", "Entertainment", "Travel", "Gifts", "Pets", "Fees", "Other"];
var CURRENCIES = ["USD", "LBP", "EUR", "AED"];
var DEFAULT_SETTINGS = { members: ["Rudy", "Aya"], people: ["Noah"], base: "USD", rates: { USD: 1, LBP: 89500, EUR: 0.92, AED: 3.6725 }, budget: null, timezone: "Asia/Beirut", goldPrice: null, cashRules: ["ATM", "Cash Withdrawal", "Careem Deliveries"], defaultPaid: {} };
var ACCOUNT_TYPES = ["cash", "bank", "savings", "investment", "gold", "loan", "card"];
var LIABILITY_TYPES = ["loan", "card"];
function bucketOf(a) {
  if (a.bucket === "saved" || a.bucket === "spending") return a.bucket;
  return ["savings", "investment", "gold"].includes(a.type) ? "saved" : "spending";
}
var TAG_WORDS = {
  Groceries: ["grocer", "spinneys", "carrefour", "supermarket", "market", "vegetable", "fruit", "bread", "milk", "chicken", "meat", "eggs", "dekkeneh", "minimarket", "charcutier"],
  Dining: ["restaurant", "dinner", "lunch", "breakfast", "burger", "pizza", "sushi", "shawarma", "manouche", "manoushe", "manakish", "delivery", "toters", "takeout", "brunch", "meal"],
  Coffee: ["coffee", "cafe", "caf\xE9", "latte", "espresso", "starbucks", "dunkin", "tea"],
  Transport: ["uber", "bolt", "taxi", "bus", "parking", "toll", "valet", "careem"],
  Fuel: ["fuel", "petrol", "gas station", "benzine", "benzin", "diesel", "gasoline"],
  Kids: ["kids", "baby", "toys", "diapers", "nursery", "daycare", "babysit", "toy", "stroller"],
  School: ["school", "tuition", "books", "stationery", "uniform", "tutoring", "university", "course"],
  Health: ["doctor", "dentist", "clinic", "hospital", "lab", "x-ray", "checkup", "therapy", "optician", "glasses"],
  Pharmacy: ["pharmacy", "medicine", "meds", "vitamins", "prescription", "panadol", "advil"],
  Home: ["furniture", "ikea", "repair", "plumber", "electrician", "cleaning", "maintenance", "decor", "garden", "paint"],
  Utilities: ["electricity", "edl", "generator", "moteur", "water", "internet", "ogero", "wifi", "alfa", "touch", "mobile", "bill"],
  Shopping: ["amazon", "shopping", "store", "mall", "electronics", "gadget", "order"],
  Clothes: ["clothes", "shoes", "shirt", "dress", "jeans", "zara", "h&m", "jacket", "sneakers"],
  Beauty: ["hair", "salon", "barber", "nails", "spa", "cosmetics", "makeup", "perfume", "skincare"],
  Entertainment: ["cinema", "movie", "netflix", "spotify", "concert", "game", "tickets", "theatre", "bar", "drinks", "club", "beach", "pool"],
  Travel: ["flight", "hotel", "airbnb", "trip", "ticket", "visa", "train", "booking", "airport"],
  Gifts: ["gift", "present", "birthday", "wedding", "flowers", "donation", "charity", "zakat"],
  Pets: ["vet", "pet", "dog", "cat"],
  Fees: ["fee", "bank", "transfer", "omt", "whish", "insurance", "tax", "fine", "commission", "withdrawal"]
};
var env = envVar;
function requireEnv(name) {
  const v = env(name);
  if (!v) throw new HttpError(500, `Server is missing the ${name} setting. Add it under the Worker's Settings \u2192 Variables and Secrets in Cloudflare.`);
  return v;
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function checkAuth(req) {
  const key = requireEnv("HOUSEHOLD_KEY");
  const url = new URL(req.url);
  const given = req.headers.get("x-ledger-key") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("key") || "";
  if (!given || given !== key) throw new HttpError(401, "Wrong household key.");
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function text(s, status = 200) {
  return new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
async function readJSON(key, fallback) {
  const v = await store().get(key, { type: "json" });
  return v == null ? fallback : v;
}
async function writeJSON(key, data) {
  await store().setJSON(key, data);
}
async function getSettings() {
  const s = await readJSON("settings", null);
  return s ? { ...DEFAULT_SETTINGS, ...s, rates: { ...DEFAULT_SETTINGS.rates, ...s.rates || {} } } : { ...DEFAULT_SETTINGS, rates: { ...DEFAULT_SETTINGS.rates } };
}
async function getMonth(mk) {
  const m = await readJSON("months/" + mk, null);
  return m && Array.isArray(m.items) ? m.items : [];
}
async function getRecurring() {
  const r = await readJSON("recurring", null);
  return r && Array.isArray(r.items) ? r.items : [];
}
async function getIncome() {
  const r = await readJSON("income", null);
  return r && Array.isArray(r.items) ? r.items : [];
}
async function getAccounts() {
  const r = await readJSON("accounts", null);
  return r && Array.isArray(r.items) ? r.items : [];
}
async function getNetworthPoints() {
  const r = await readJSON("networth", null);
  return r && Array.isArray(r.points) ? r.points : [];
}
function accountUSD(settings, a) {
  if (a.type === "gold") {
    const g = Number(a.grams) || 0;
    const price = Number(settings.goldPrice) || 0;
    if (g > 0 && price > 0) return g * price;
  }
  return toUSD(settings, a.amount, a.currency);
}
function netWorth(settings, accounts) {
  let assets = 0, debts = 0;
  for (const a of accounts) {
    if (a.active === false) continue;
    const v = accountUSD(settings, a);
    if (LIABILITY_TYPES.includes(a.type)) debts += v;
    else assets += v;
  }
  return { assets, debts, net: assets - debts };
}
async function recordSnapshot(settings, accounts, today) {
  const { assets, debts } = netWorth(settings, accounts);
  const flow = accounts.filter((a) => a.active !== false && ["cash", "bank", "savings", "card"].includes(a.type)).reduce((t, a) => t + (a.type === "card" ? -toUSD(settings, a.amount, a.currency) : toUSD(settings, a.amount, a.currency)), 0);
  const saved = accounts.filter((a) => a.active !== false && !LIABILITY_TYPES.includes(a.type) && bucketOf(a) === "saved").reduce((t, a) => t + accountUSD(settings, a), 0);
  const pts = (await getNetworthPoints()).filter((p) => p.date !== today);
  pts.push({ date: today, assets: Math.round(assets), debts: Math.round(debts), flow: Math.round(flow), saved: Math.round(saved) });
  pts.sort((a, b) => a.date < b.date ? -1 : 1);
  await writeJSON("networth", { points: pts.slice(-400) });
  return pts;
}
function incomeMonthlyUSD(settings, items) {
  return items.filter((i) => i.active !== false).reduce((a, i) => {
    const u = toUSD(settings, i.amount, i.currency);
    return a + (i.period === "yearly" ? u / 12 : u);
  }, 0);
}
async function listKeys(prefix) {
  try {
    const { blobs } = await store().list({ prefix });
    return blobs.map((b) => b.key.slice(prefix.length)).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  } catch (e) {
    return [];
  }
}
async function listMonthKeys() {
  return listKeys("months/");
}
async function mutateList(key, fn) {
  const s = store();
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const items = cur && cur.data && Array.isArray(cur.data.items) ? cur.data.items : [];
    const next = fn(items.slice());
    const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    let res;
    try {
      res = await s.setJSON(key, { items: next }, opts);
    } catch (e) {
      if (attempt === 4) throw e;
      res = { modified: false };
    }
    if (!res || res.modified !== false) return next;
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
  }
  throw new HttpError(409, "The ledger was busy. Try again.");
}
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
  } catch (e) {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
}
function weekdayIn(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz || "Asia/Beirut", weekday: "long" }).format(/* @__PURE__ */ new Date());
  } catch (e) {
    return "";
  }
}
function shiftMonth(mk, n) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function daysInMonth(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function rate(settings, c) {
  const r = (settings.rates || {})[c];
  return Number(r) > 0 ? Number(r) : 1;
}
function toUSD(settings, amount, cur) {
  return Number(amount || 0) / rate(settings, cur || "USD");
}
function fmt(settings, usd) {
  const c = settings.base || "USD";
  const v = usd * rate(settings, c);
  const dec = c === "LBP" ? 0 : Math.abs(v) % 1 < 5e-3 ? 0 : 2;
  const n = v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (c === "USD" ? "$" : c === "LBP" ? "L.L. " : c === "EUR" ? "\u20AC" : c === "AED" ? "AED " : c + " ") + n;
}
function fmtAmount(amount, c) {
  const dec = c === "LBP" ? 0 : Math.abs(amount) % 1 < 5e-3 ? 0 : 2;
  const n = Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (c === "USD" ? "$" : c === "LBP" ? "L.L. " : c === "EUR" ? "\u20AC" : c === "AED" ? "AED " : c + " ") + n;
}
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function memberName(settings, name) {
  if (!name) return null;
  const i = (settings.members || []).findIndex((m) => m.toLowerCase() === String(name).toLowerCase());
  return i >= 0 ? settings.members[i] : null;
}
var NUMWORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1e3, million: 1e6 };
var reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function wordsToNumber(str) {
  const toks = str.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  let total = 0, cur = 0, found = false;
  for (const t of toks) {
    const v = NUMWORDS[t];
    if (v == null) {
      if (t === "and") continue;
      if (found) break;
      else continue;
    }
    found = true;
    if (v === 100) {
      cur = (cur || 1) * 100;
    } else if (v >= 1e3) {
      total += (cur || 1) * v;
      cur = 0;
    } else cur += v;
  }
  return found ? total + cur : null;
}
function guessTag(t) {
  t = String(t).toLowerCase();
  let best = "Other", score = 0;
  for (const [tag, words] of Object.entries(TAG_WORDS)) {
    for (const w of words) {
      if (t.includes(w) && w.length > score) {
        best = tag;
        score = w.length;
      }
    }
  }
  return best;
}
function parseLocal(settings, text2, today) {
  const raw = String(text2).trim();
  const t = raw.toLowerCase();
  let currency = settings.base || "USD";
  if (/\b(lira|lbp|l\.l\.?|ll|ليرة)\b/.test(t)) currency = "LBP";
  else if (/\$|\b(usd|dollars?|bucks|دولار)\b/.test(t)) currency = "USD";
  else if (/€|\b(eur|euros?)\b/.test(t)) currency = "EUR";
  else if (/\b(aed|dirhams?|درهم)\b/.test(t)) currency = "AED";
  let amount = null;
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)(?:\s*(k|m|thousand|million)\b)?/);
  if (m) {
    amount = parseFloat(m[1].replace(/,/g, ""));
    const mult = m[2];
    if (mult === "k" || mult === "thousand") amount *= 1e3;
    if (mult === "m" || mult === "million") amount *= 1e6;
  } else {
    const w = wordsToNumber(t);
    if (w != null) amount = w;
  }
  let desc = raw.replace(/\$|€/g, "").replace(/\b\d[\d,]*(?:\.\d+)?(?:\s*(k|m|thousand|million)\b)?/ig, " ").replace(/\b(lira|lbp|l\.l\.?|ll|usd|dollars?|bucks|eur|euros?|aed|dirhams?)\b/ig, " ");
  Object.keys(NUMWORDS).forEach((w) => {
    desc = desc.replace(new RegExp("\\b" + w + "\\b", "ig"), " ");
  });
  desc = desc.replace(/\b(for|on|at|of|spent|paid|bought|and|the|a|an|add|expense|expenses|to|my)\b/ig, " ").replace(/\s+/g, " ").trim();
  let by = null;
  for (const mname of settings.members || []) {
    const re = new RegExp("\\b" + reEsc(mname) + "\\b", "i");
    if (re.test(t)) {
      by = mname;
      desc = desc.replace(new RegExp("\\b" + reEsc(mname) + "\\b", "ig"), " ").replace(/\s+/g, " ").trim();
    }
  }
  let date = today;
  if (/\byesterday\b/.test(t)) {
    const d = /* @__PURE__ */ new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    date = d.toISOString().slice(0, 10);
    desc = desc.replace(/yesterday/ig, "").trim();
  }
  const tag = guessTag(t);
  desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : tag;
  if (/\b(moved|move|transfer(?:red)?|withdrew|withdraw|withdrawal|deposit(?:ed)?|paid (?:the |my )?(?:credit )?card|card payment|to savings|aside|vault|long[- ]term|permanent savings)\b/.test(t) && !/\b(fees?|charges?|commission)\b/.test(t)) {
    const pick = (w) => /\b(savings?|vault|permanent|long|aside)\b/.test(w) ? "savings" : /\bcard\b/.test(w) ? "card" : /\bcash\b/.test(w) ? "cash" : /\bbank|account\b/.test(w) ? "bank" : null;
    let from = null, to = null;
    const mFrom = t.match(/\bfrom\s+(?:the |my )?(\w+)/), mTo = t.match(/\b(?:to|into)\s+(?:the |my )?(\w+)/);
    if (mFrom) from = pick(mFrom[1]);
    if (mTo) to = pick(mTo[1]);
    if (/withdr/.test(t)) {
      from = from || "bank";
      to = to || "cash";
    } else if (/deposit/.test(t)) {
      from = from || "cash";
      to = to || "bank";
    } else if (/card/.test(t)) {
      from = from || "bank";
      to = to || "card";
    } else if (/savings|vault|aside|long[- ]term|permanent/.test(t)) {
      from = from || "bank";
      to = to || "savings";
    }
    const label = to === "card" ? "Credit card payment" : to === "cash" ? "Cash withdrawal" : to === "savings" ? "To long-term savings" : "Transfer";
    return [{ kind: "transfer", from: from || "bank", to: to || "cash", amount: amount == null ? 0 : amount, currency, description: label, tag: "Other", date, by, note: null, paidWith: null }];
  }
  const paidWith = /\b(by|with|on|using)\s+(?:the |my )?card\b/.test(t) ? "card" : /\bcash\b/.test(t) ? "cash" : /\b(from|by|with)\s+(?:the |my )?bank\b/.test(t) ? "bank" : null;
  return [{ kind: "expense", paidWith, from: null, to: null, amount: amount == null ? 0 : amount, currency, description: desc.replace(/\b(cash|by card|with card|card)\b/ig, "").replace(/\s+/g, " ").trim() || tag, tag, date, by, note: null }];
}
async function claudeMessage({ model, system, messages, max_tokens = 600, stream = false, signal }) {
  const key = requireEnv("ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens, system, messages, stream })
  });
  if (!res.ok) {
    let msg = "";
    try {
      const e = await res.json();
      msg = e.error?.message || JSON.stringify(e);
    } catch (e) {
      msg = await res.text();
    }
    throw new HttpError(res.status === 401 ? 500 : 502, `Claude request failed (${res.status}): ${msg}`);
  }
  return res;
}
function parseModel() {
  return env("PARSE_MODEL") || "claude-haiku-5-5";
}
function analysisModel() {
  return env("ANALYSIS_MODEL") || "claude-sonnet-5-5";
}
async function parseWithClaude(settings, textIn, today) {
  const system = `You turn one short spoken or typed note into expense records for a household ledger. Reply with only a JSON array of one or more objects (most notes are exactly one expense). No prose, no code fences.
Today: ${today} (${weekdayIn(settings.timezone)}). Household members: ${settings.members.join(", ")}. Default currency: ${settings.base}. Other currencies in use: LBP (Lebanese lira; people say "lira", "L.L.", "500 thousand", "2 million" meaning lira), EUR, and AED (UAE dirhams; "dirhams", "AED").
Tags, pick exactly one per expense: ${TAGS.join(", ")}.
Object shape: {"kind": "expense"|"transfer", "amount": number, "currency": "USD"|"LBP"|"EUR"|"AED", "description": string, "tag": string, "date": "YYYY-MM-DD", "by": string|null, "note": string|null, "paidWith": "cash"|"card"|"bank"|null, "from": "cash"|"bank"|"savings"|"card"|null, "to": "cash"|"bank"|"savings"|"card"|null}
kind is "transfer" when money moved between the household's own accounts rather than being spent: withdrew cash / took out money (bank\u2192cash), paid the credit card or card bill (bank\u2192card), moved to savings / the vault / long-term / permanent savings / put aside (\u2192savings), deposited cash (cash\u2192bank); then set from and to, and description like "Cash withdrawal", "Credit card payment" or "To long-term savings". Otherwise kind is "expense" and paidWith is "cash", "card" or "bank" only when the note says how it was paid ("cash", "by card", "with the card", "from the bank"), else null.
Rules: amount is the number spent (spoken numbers like "forty five" become 45; "1.2k" is 1200; "500 thousand lira" is 500000 LBP); the note may start with filler like "add to my expenses", ignore it; description is 2-6 words saying what or where, Title Case, with no amount or currency in it; date is today unless the note says otherwise (yesterday, last Tuesday, on the 3rd); by is a member name only when the note says who paid, else null; note keeps any leftover detail, else null. If no amount can be found, use 0.`;
  const res = await claudeMessage({ model: parseModel(), system, max_tokens: 400, messages: [{ role: "user", content: `Note: """${String(textIn).replace(/"""/g, '"')}"""` }] });
  const data = await res.json();
  const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = out.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, "Claude did not return JSON.");
  let parsed = JSON.parse(m[0]);
  if (!Array.isArray(parsed)) parsed = [parsed];
  const AT2 = ["cash", "bank", "savings", "card"];
  return parsed.map((o) => ({
    kind: o.kind === "transfer" ? "transfer" : "expense",
    paidWith: AT2.includes(o.paidWith) ? o.paidWith : null,
    from: AT2.includes(o.from) ? o.from : null,
    to: AT2.includes(o.to) ? o.to : null,
    amount: Math.abs(Number(o.amount)) || 0,
    currency: CURRENCIES.includes(String(o.currency || "").toUpperCase()) ? String(o.currency).toUpperCase() : settings.base,
    description: String(o.description || "").trim().slice(0, 80) || "Expense",
    tag: TAGS.includes(o.tag) ? o.tag : guessTag(String(o.description || "") + " " + textIn),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || "")) ? o.date : today,
    by: memberName(settings, o.by),
    note: o.note ? String(o.note).slice(0, 200) : null
  }));
}
async function parseNote(settings, text2, today) {
  try {
    const items = await parseWithClaude(settings, text2, today);
    if (items.length) return { items, via: "claude" };
  } catch (e) {
    return { items: parseLocal(settings, text2, today), via: "local", error: e.message };
  }
  return { items: parseLocal(settings, text2, today), via: "local" };
}
async function saveExpenses(settings, items, { by, source }) {
  const saved = [];
  const byMonth = {};
  for (const p of items) {
    const date = p.date;
    const mk = date.slice(0, 7);
    const cur = p.currency || settings.base;
    const doc = { id: newId(), amount: Number(p.amount) || 0, currency: cur, usd: toUSD(settings, p.amount, cur), desc: p.description || p.desc || "Expense", tag: TAGS.includes(p.tag) ? p.tag : "Other", by: p.by || by || "", date, month: mk, ts: Date.now(), source: source || "text", note: p.note || null, from: p.from || null, ...p.raw ? { raw: String(p.raw).slice(0, 200) } : {} };
    (byMonth[mk] = byMonth[mk] || []).push(doc);
    saved.push(doc);
  }
  for (const [mk, docs2] of Object.entries(byMonth)) {
    await mutateList("months/" + mk, (items2) => items2.concat(docs2));
  }
  return saved;
}
function monthStats(settings, items, recurring, mk, today) {
  const byTag = {}, byPerson = {};
  let total = 0;
  const byDay = {};
  for (const e of items) {
    total += e.usd;
    byTag[e.tag] = (byTag[e.tag] || 0) + e.usd;
    const p = e.by || "Unknown";
    byPerson[p] = (byPerson[p] || 0) + e.usd;
    const d = Number(e.date.slice(8, 10));
    byDay[d] = (byDay[d] || 0) + e.usd;
  }
  const fixed = recurring.filter((r) => r.active !== false).reduce((a, r) => {
    const u = toUSD(settings, r.amount, r.currency);
    return a + (r.period === "yearly" ? u / 12 : u);
  }, 0);
  const dim = daysInMonth(mk);
  const cm = today.slice(0, 7);
  const elapsed = mk === cm ? Number(today.slice(8, 10)) : mk < cm ? dim : 0;
  return { items, total, byTag, byPerson, byDay, fixed, dim, elapsed, count: items.length };
}
var monthLabel = (k) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
function analysisPrompt(settings, mk, st, m1, m2, recurring, today, incomeUSD = 0, wealth = null) {
  const usd = (v) => Math.round(v);
  const tagLine = (s) => Object.entries(s.byTag).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${usd(v)}`).join(", ") || "none";
  const perLine = (s) => Object.entries(s.byPerson).map(([p, v]) => `${p} ${usd(v)}`).join(", ") || "none";
  const big = [...st.items].sort((a, b) => b.usd - a.usd).slice(0, 8).map((e) => `${e.date.slice(5)} ${e.desc} (${e.tag}, ${e.by || "?"}) ${usd(e.usd)}`).join("; ") || "none";
  const recs = recurring.filter((r) => r.active !== false).map((r) => {
    const u = toUSD(settings, r.amount, r.currency);
    return `${r.name} [${r.kind || "other"}] ${usd(r.period === "yearly" ? u / 12 : u)}/mo${r.period === "yearly" ? " (billed yearly)" : ""}`;
  }).join("; ") || "none";
  const budget = Number(settings.budget) ? `Monthly budget: ${usd(toUSD(settings, settings.budget, settings.base))}.` : "No budget set.";
  const projected = st.elapsed >= 3 ? st.total / st.elapsed * st.dim : st.total;
  const incomeLine = incomeUSD > 0 ? `Household income: ${usd(incomeUSD)} per month. Projected left over this month after day-to-day and fixed costs: ${usd(incomeUSD - projected - st.fixed)} (${Math.round((incomeUSD - projected - st.fixed) / incomeUSD * 100)}% of income).` : "Income not recorded.";
  const label = monthLabel;
  return {
    system: coachSystem(settings),
    user: `Month in view: ${label(mk)}, ${st.elapsed} of ${st.dim} days elapsed. Day-to-day total ${usd(st.total)} across ${st.count} items, daily average ${st.elapsed ? usd(st.total / st.elapsed) : 0}, projected month-end day-to-day ${usd(projected)}${st.elapsed < 3 ? " (too early in the month to project; treat it as the total so far)" : ""}.
By category: ${tagLine(st)}. By person: ${perLine(st)}.
Largest items: ${big}.
Previous month (${label(shiftMonth(mk, -1))}, full): total ${usd(m1.total)}; by category: ${tagLine(m1)}; by person: ${perLine(m1)}.
Two months ago (${label(shiftMonth(mk, -2))}): total ${usd(m2.total)}; by category: ${tagLine(m2)}.
Fixed monthly costs (${usd(st.fixed)}/mo in total): ${recs}.
${incomeLine}
${wealthLine(wealth, st.total + st.fixed)}
${budget}`
  };
}
function wealthLine(w, monthlySpend) {
  if (!w || !w.assets && !w.debts) return "";
  const usd = (v) => Math.round(v);
  const runway = monthlySpend > 0 ? (w.liquid / monthlySpend).toFixed(1) : "n/a";
  return `Balances today: assets ${usd(w.assets)} (of which everyday money in bank and pocket cash ${usd(w.liquid)}; long-term savings not to be touched ${usd(w.saved || 0)}), debts ${usd(w.debts)}, net worth ${usd(w.net)}. Everyday money covers about ${runway} months of total spending.${w.savedThisMonth != null ? ` Moved into long-term savings this month: ${usd(w.savedThisMonth)}.` : ""} Mention this in "Fixed costs" or "Try this" only when it changes the advice (for example an expensive debt worth paying down, or a thin cushion).`;
}
function coachSystem(settings) {
  return `You are a careful, friendly household finance coach for a two-person household (${settings.members.join(" and ")}) living in Lebanon. Reply in plain text only (no markdown symbols such as # or **), at most 230 words, using exactly these short section titles on their own lines: Headline / Watch out / Try this / Fixed costs. In "Watch out" name the categories or items that look high or unusual with their numbers. In "Try this" give 3 concrete, specific changes, each with a rough monthly saving in dollars. In "Fixed costs" say in one or two sentences how large subscriptions and staff salaries are relative to everything and whether anything there deserves a second look. When household income is given, open the Headline with how much of it is left over (the savings rate) and whether that is healthy. Be specific to the numbers; no generic advice; no greetings. Amounts are in USD.`;
}
function rangeAnalysisPrompt(settings, perMonth, prior, recurring, incomeUSD = 0, wealth = null) {
  const usd = (v) => Math.round(v);
  const agg = { byTag: {}, byPerson: {}, total: 0, count: 0, items: [] };
  for (const { st } of perMonth) {
    agg.total += st.total;
    agg.count += st.count;
    agg.items.push(...st.items);
    for (const [t, v] of Object.entries(st.byTag)) agg.byTag[t] = (agg.byTag[t] || 0) + v;
    for (const [p, v] of Object.entries(st.byPerson)) agg.byPerson[p] = (agg.byPerson[p] || 0) + v;
  }
  const n = perMonth.length;
  const fixed = perMonth[0].st.fixed;
  const tagLine = (s) => Object.entries(s.byTag).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${usd(v)} (${usd(v / n)}/mo)`).join(", ") || "none";
  const perLine = (s) => Object.entries(s.byPerson).map(([p, v]) => `${p} ${usd(v)}`).join(", ") || "none";
  const months = perMonth.map(({ mk, st }) => `${monthLabel(mk)} ${usd(st.total)}`).join(", ");
  const big = [...agg.items].sort((a, b) => b.usd - a.usd).slice(0, 8).map((e) => `${e.date} ${e.desc} (${e.tag}, ${e.by || "?"}) ${usd(e.usd)}`).join("; ") || "none";
  const recs = recurring.filter((r) => r.active !== false).map((r) => {
    const u = toUSD(settings, r.amount, r.currency);
    return `${r.name} [${r.kind || "other"}] ${usd(r.period === "yearly" ? u / 12 : u)}/mo`;
  }).join("; ") || "none";
  const budget = Number(settings.budget) ? `Monthly budget: ${usd(toUSD(settings, settings.budget, settings.base))}.` : "No budget set.";
  const priorLine = prior && prior.total ? `The ${n} months before that: day-to-day total ${usd(prior.total)} (${usd(prior.total / n)}/mo); by category: ${Object.entries(prior.byTag).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${usd(v)}`).join(", ") || "none"}.` : "No data for the months before this range.";
  return {
    system: coachSystem(settings).replace("Month in view", "Period in view") + " The data covers several months: talk about monthly averages and the trend from month to month, and name the months where spending jumped.",
    user: `Period in view: ${monthLabel(perMonth[0].mk)} to ${monthLabel(perMonth[n - 1].mk)} (${n} months). Day-to-day per month: ${months}. Total ${usd(agg.total)} across ${agg.count} items, average ${usd(agg.total / n)} per month.
By category over the period: ${tagLine(agg)}. By person: ${perLine(agg)}.
Largest single items: ${big}.
${priorLine}
Fixed monthly costs (${usd(fixed)}/mo in total, ${usd(fixed * n)} over the period): ${recs}.
${incomeUSD > 0 ? `Household income: ${usd(incomeUSD)} per month, ${usd(incomeUSD * n)} over the period; left over after all spending: ${usd(incomeUSD * n - agg.total - fixed * n)} (${Math.round((incomeUSD * n - agg.total - fixed * n) / (incomeUSD * n) * 100)}% of income).` : "Income not recorded."}
${wealthLine(wealth, agg.total / n + fixed)}
${budget}`
  };
}

// src/lib/flow.mjs
var MOVE_KINDS = ["transfer", "income", "refund", "adjust"];
var FLOW_TYPES = ["cash", "bank", "savings", "card"];
async function getMoves(mk) {
  const m = await readJSON("moves/" + mk, null);
  return m && Array.isArray(m.items) ? m.items : [];
}
async function saveMove(settings, m, { by, source }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(m.date || "") ? m.date : null;
  if (!date) throw new HttpError(400, "Bad date");
  const cur = m.currency || settings.base;
  const amount = Math.abs(Number(m.amount)) || 0;
  if (!(amount > 0)) throw new HttpError(400, "Amount required");
  const doc = { id: m.id || newId(), kind: MOVE_KINDS.includes(m.kind) ? m.kind : "transfer", fromAcc: m.fromAcc || null, toAcc: m.toAcc || null, amount, currency: cur, usd: toUSD(settings, amount, cur), desc: String(m.desc || "").slice(0, 80) || kindLabel(m.kind), date, month: date.slice(0, 7), ts: m.ts || Date.now(), source: source || "manual", by: String(m.by || by || "").slice(0, 40), incomeId: m.incomeId || null, note: m.note ? String(m.note).slice(0, 120) : null, ...m.raw ? { raw: String(m.raw).slice(0, 200) } : {} };
  await mutateList("moves/" + doc.month, (items) => {
    const i = items.findIndex((x) => x.id === doc.id);
    if (i >= 0) items[i] = doc;
    else items.push(doc);
    return items;
  });
  return doc;
}
async function deleteMove(mk, id) {
  await mutateList("moves/" + mk, (items) => items.filter((x) => x.id !== id));
}
function kindLabel(k) {
  return k === "income" ? "Income received" : k === "refund" ? "Refund" : k === "adjust" ? "Adjustment" : "Transfer";
}
var digits = (s) => String(s || "").replace(/\D/g, "");
function matchBank(accounts, { mask, last4, owner }) {
  const banks = accounts.filter((a) => a.type === "bank" && a.active !== false);
  if (!banks.length) return null;
  if (mask) {
    const d = digits(mask);
    const hit = banks.find((a) => a.mask && (digits(a.mask) === d || d.length >= 6 && digits(a.mask).endsWith(d.slice(-3)) && digits(a.mask).startsWith(d.slice(0, 3))));
    if (hit) return hit;
  }
  if (last4) {
    const hit = banks.find((a) => String(a.last4 || "") === String(last4));
    if (hit) return hit;
  }
  if (owner) {
    const mine = banks.filter((a) => String(a.owner || "").toLowerCase() === String(owner).toLowerCase());
    if (mine.length === 1) return mine[0];
  }
  return banks.length === 1 ? banks[0] : null;
}
function matchCardAcc(accounts, { last4, owner }) {
  const cards = accounts.filter((a) => a.type === "card" && a.active !== false);
  if (!cards.length) return null;
  if (last4) {
    const c = cards.find((a) => String(a.last4 || "") === String(last4));
    if (c) return c;
  }
  if (owner) {
    const mine = cards.filter((a) => String(a.owner || "").toLowerCase() === String(owner).toLowerCase());
    if (mine.length === 1) return mine[0];
  }
  return cards.length === 1 ? cards[0] : null;
}
async function accountOfType(settings, accounts, type, owner, { create = false, currency } = {}) {
  const own = (a) => !owner || String(a.owner || "").toLowerCase() === String(owner).toLowerCase();
  const pool = type === "savings" ? accounts.filter((a) => a.active !== false && (a.type === "savings" || bucketOf(a) === "saved" && ["cash", "bank"].includes(a.type))) : type === "cash" ? accounts.filter((a) => a.active !== false && a.type === "cash" && bucketOf(a) === "spending") : accounts.filter((a) => a.active !== false && a.type === type);
  const mine = pool.filter(own);
  if (mine.length) return mine.sort((a, b) => (a.type === "savings" ? 0 : 1) - (b.type === "savings" ? 0 : 1))[0];
  const joint = pool.filter((a) => !a.owner || String(a.owner).toLowerCase() === "joint");
  if (joint.length) return joint[0];
  const any = pool;
  if (any.length === 1 && !owner) return any[0];
  if (any.length && type === "savings") return any[0];
  if (create && type === "cash") {
    const now = Date.now();
    const doc = { id: newId(), name: owner ? `Cash in hand (${owner})` : "Cash in hand", type: "cash", owner: owner || "Joint", amount: 0, currency: currency || settings.base, confirmed: { amount: 0, date: new Date(now).toISOString().slice(0, 10), ts: now - 1 }, active: true, ts: now };
    await mutateList("accounts", (items) => items.concat([doc]));
    accounts.push(doc);
    return doc;
  }
  return null;
}
function isCashOut(settings, merchant) {
  const rules = (settings.cashRules && settings.cashRules.length ? settings.cashRules : ["ATM", "Cash Withdrawal", "Careem Deliveries"]).map((s) => String(s).toLowerCase()).filter(Boolean);
  const m = String(merchant || "").toLowerCase();
  return rules.some((r) => m.includes(r));
}
async function confirmBalance(settings, id, actual, today, extra = {}) {
  const amt = Math.max(0, Math.round(Number(actual) * 100) / 100);
  const before = await getAccounts();
  const acc = before.find((a) => a.id === id);
  if (!acc) return null;
  let agree = true;
  if (acc.confirmed) {
    const rec = await reconcile(settings, before.map((a) => a.id === id ? { ...a, amount: amt } : a), today);
    const r = rec[id];
    agree = !r || r.gap === 0;
  }
  let updated = null;
  const items = await mutateList("accounts", (items2) => items2.map((a) => {
    if (a.id !== id) return a;
    updated = { ...a, ...extra, amount: amt, confirmed: agree ? { amount: amt, date: today, ts: Date.now() } : a.confirmed, updatedAt: today };
    return updated;
  }));
  await recordSnapshot(settings, items, today);
  return { account: updated, accounts: items, agree };
}
async function withSync(settings, today, ids, fn) {
  ids = (ids || []).filter(Boolean);
  const pre = ids.length ? await reconcile(settings, await getAccounts(), today) : {};
  const result = await fn();
  if (ids.length) {
    const post = await reconcile(settings, await getAccounts(), today);
    const upd = ids.filter((id) => pre[id] && pre[id].gap === 0 && post[id] && Math.abs(post[id].expected - post[id].actual) >= 5e-3);
    if (upd.length) {
      const now = Date.now();
      const items = await mutateList("accounts", (items2) => items2.map((a) => {
        if (!upd.includes(a.id)) return a;
        const v = Math.round(post[a.id].expected * 100) / 100;
        const extra = a.type === "card" && Number(a.limit) > 0 ? { available: Math.max(0, Math.round((Number(a.limit) - v) * 100) / 100) } : {};
        return { ...a, ...extra, amount: v, updatedAt: today };
      }));
      await recordSnapshot(settings, items, today);
    }
  }
  return result;
}
async function advanceBaseline(id, today) {
  return mutateList("accounts", (items) => items.map((a) => a.id === id ? { ...a, confirmed: { amount: Number(a.amount) || 0, date: today, ts: Date.now() } } : a));
}
async function applyReading(settings, acc, available, availableCurrency, today) {
  if (!acc) return null;
  if (availableCurrency && acc.currency && availableCurrency !== acc.currency) return null;
  if (acc.type === "card") {
    const limit = Number(acc.limit) || 0;
    if (!(limit > 0)) return null;
    const avail = Math.max(0, Math.min(limit, Number(available) || 0));
    return confirmBalance(settings, acc.id, limit - avail, today, { available: avail });
  }
  return confirmBalance(settings, acc.id, Number(available) || 0, today);
}
var inCur = (settings, usd, cur) => usd * rate(settings, cur || "USD");
async function reconcile(settings, accounts, today, preloaded = null) {
  const flow = accounts.filter((a) => a.active !== false && FLOW_TYPES.includes(a.type));
  if (!flow.length) return {};
  const cm = today.slice(0, 7);
  let earliest = cm;
  for (const a of flow) {
    const d = a.confirmed ? String(a.confirmed.date || "") : a.ts ? new Date(a.ts).toISOString().slice(0, 10) : "";
    const mk = d.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mk) && mk < earliest) earliest = mk;
  }
  const keys = [shiftMonth(cm, 1)];
  for (let i = 0; i < 24; i++) {
    const k = shiftMonth(cm, -i);
    if (i >= 6 && k < earliest) break;
    keys.push(k);
  }
  const pm = preloaded && preloaded.months || {}, pv = preloaded && preloaded.moves || {};
  const [months, moves] = await Promise.all([Promise.all(keys.map((k) => pm[k] ? pm[k] : getMonth(k))), Promise.all(keys.map((k) => pv[k] ? pv[k] : getMoves(k)))]);
  const expenses = months.flat(), mv = moves.flat();
  const out = {};
  for (const a of flow) {
    const liab = a.type === "card";
    const since = a.confirmed ? a.confirmed.ts : a.ts || null;
    const base = a.confirmed ? a.confirmed.amount : Number(a.amount) || 0;
    let exp = base, n = 0, flowAbs = 0;
    const val = (x) => x.currency === a.currency ? Number(x.amount) || 0 : inCur(settings, x.usd, a.currency);
    for (const e of expenses) {
      if (e.from !== a.id || since && e.ts <= since) continue;
      const v = val(e);
      exp += liab ? v : -v;
      n++;
      flowAbs += Math.abs(v);
    }
    for (const m of mv) {
      if (since && m.ts <= since) continue;
      if (m.toAcc !== a.id && m.fromAcc !== a.id) continue;
      const v = val(m);
      if (m.toAcc === a.id) {
        exp += liab ? -v : v;
        n++;
        flowAbs += Math.abs(v);
      }
      if (m.fromAcc === a.id) {
        exp += liab ? v : -v;
        n++;
        flowAbs += Math.abs(v);
      }
    }
    const actual = Number(a.amount) || 0;
    let gap = Math.round((actual - exp) * 100) / 100;
    const tol = 1 + 0.01 * flowAbs;
    if (Math.abs(gap) <= tol) gap = 0;
    out[a.id] = { expected: Math.round(exp * 100) / 100, actual, gap, since: a.confirmed ? a.confirmed.date : null, confirmed: !!a.confirmed, pending: n };
  }
  return out;
}
async function rollStatements(settings, today) {
  const now = Date.now();
  const RETIRED = ["payDay", "statementDay", "due", "dueSetBy", "statementSnap", "lastPayment"];
  const patchFor = (a) => {
    const p = {};
    if (FLOW_TYPES.includes(a.type) && !a.confirmed) p.confirmed = { amount: Number(a.amount) || 0, date: today, ts: now };
    if (RETIRED.some((k) => a[k] != null)) p._strip = true;
    return Object.keys(p).length ? p : null;
  };
  const accounts = await getAccounts();
  if (!accounts.some(patchFor)) return accounts;
  return mutateList("accounts", (items) => items.map((a) => {
    const p = patchFor(a);
    if (!p) return a;
    const n = { ...a, ...p };
    delete n._strip;
    if (p._strip) for (const k of RETIRED) delete n[k];
    return n;
  }));
}
async function mergeDuplicateCash(settings, today) {
  const accounts = await getAccounts();
  const auto = (a) => a.type === "cash" && a.active !== false && /^cash in hand(\s*\(.*\))?$/i.test(String(a.name || "").trim());
  const groups = {};
  for (const a of accounts) {
    if (!auto(a)) continue;
    const k = [String(a.owner || "joint").toLowerCase(), bucketOf(a), a.currency || settings.base].join("|");
    (groups[k] = groups[k] || []).push(a);
  }
  const remap = {};
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const d of g.slice(1)) remap[d.id] = g[0].id;
  }
  const gone = Object.keys(remap);
  if (!gone.length) return 0;
  for (const mk of await listKeys("months/")) {
    if ((await getMonth(mk)).some((e) => remap[e.from])) await mutateList("months/" + mk, (items2) => items2.map((e) => remap[e.from] ? { ...e, from: remap[e.from] } : e));
  }
  for (const mk of await listKeys("moves/")) {
    if ((await getMoves(mk)).some((m) => remap[m.fromAcc] || remap[m.toAcc])) await mutateList("moves/" + mk, (items2) => items2.map((m) => {
      const f = remap[m.fromAcc] || m.fromAcc, t = remap[m.toAcc] || m.toAcc;
      return f !== m.fromAcc || t !== m.toAcc ? { ...m, fromAcc: f, toAcc: t } : m;
    }));
  }
  const now = Date.now();
  const items = await mutateList("accounts", (items2) => {
    const sums = {};
    for (const a of items2) {
      if (remap[a.id]) sums[remap[a.id]] = (sums[remap[a.id]] || 0) + (Number(a.amount) || 0);
    }
    return items2.filter((a) => !remap[a.id]).map((a) => {
      if (sums[a.id] == null) return a;
      const amount = Math.round(((Number(a.amount) || 0) + sums[a.id]) * 100) / 100;
      return { ...a, amount, confirmed: { amount, date: today, ts: now }, updatedAt: today };
    });
  });
  await recordSnapshot(settings, items, today);
  return gone.length;
}
async function monthCheck(settings, mk, accounts, networth, today) {
  const [expenses, moves, income] = await Promise.all([getMonth(mk), getMoves(mk), getIncome()]);
  const spentUSD = expenses.reduce((t, e) => t + e.usd, 0);
  const incomeUSD = moves.filter((m) => m.kind === "income").reduce((t, m) => t + m.usd, 0);
  const refundsUSD = moves.filter((m) => m.kind === "refund").reduce((t, m) => t + m.usd, 0);
  const adjustUSD = moves.filter((m) => m.kind === "adjust").reduce((t, m) => t + (m.toAcc ? m.usd : -m.usd), 0);
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const bk = (id) => byId[id] ? bucketOf(byId[id]) : null;
  const savedUSD = moves.filter((m) => m.kind === "transfer").reduce((t, m) => t + (bk(m.toAcc) === "saved" && bk(m.fromAcc) !== "saved" ? m.usd : bk(m.fromAcc) === "saved" && bk(m.toAcc) !== "saved" ? -m.usd : 0), 0);
  const planned = income.filter((i) => i.active !== false).map((i) => ({ id: i.id, name: i.name, by: i.by, usd: toUSD(settings, i.amount, i.currency) * (i.period === "yearly" ? 1 / 12 : 1), received: moves.some((m) => m.kind === "income" && m.incomeId === i.id) }));
  const flowNow = accounts.filter((a) => a.active !== false && FLOW_TYPES.includes(a.type)).reduce((t, a) => t + (a.type === "card" ? -toUSD(settings, a.amount, a.currency) : toUSD(settings, a.amount, a.currency)), 0);
  const pts = (networth || []).filter((p) => p.flow != null);
  const startPt = [...pts].reverse().find((p) => p.date < mk + "-01") || pts.find((p) => p.date >= mk + "-01");
  const endPt = [...pts].reverse().find((p) => p.date <= mk + "-31");
  const actualDelta = startPt && endPt && startPt !== endPt ? endPt.flow - startPt.flow : null;
  return { month: mk, spentUSD, incomeUSD, refundsUSD, adjustUSD, savedUSD, planned, plannedUSD: planned.reduce((t, p) => t + p.usd, 0), expectedDelta: incomeUSD + refundsUSD - spentUSD, actualDelta, flowNow, startDate: startPt ? startPt.date : null };
}

// src/lib/book.mjs
var AT = ["cash", "bank", "savings", "card"];
async function resolveAcc(settings, accounts, type, owner) {
  if (!type) return null;
  const a = await accountOfType(settings, accounts, type, owner, { create: true, currency: type === "cash" ? "USD" : settings.base });
  return a ? a.id : null;
}
async function bookItems(settings, items, { by, source, today, accounts } = {}) {
  accounts = accounts || await getAccounts();
  const transfers = items.filter((i) => i.kind === "transfer" && i.amount > 0);
  const blank = items.filter((i) => i.kind === "transfer" && !(i.amount > 0));
  items = items.filter((i) => i.kind !== "transfer");
  if (!transfers.length && !items.length && blank.length) return { saved: [], moves: [], draft: { ...blank[0], by: blank[0].by || by } };
  const moves = [];
  for (const t of transfers) {
    const owner = t.by || by;
    const fromAcc = await resolveAcc(settings, accounts, t.from || "bank", owner);
    const toAcc = await resolveAcc(settings, accounts, t.to || "cash", owner);
    moves.push(await withSync(settings, today, [fromAcc, toAcc], () => saveMove(settings, { kind: "transfer", fromAcc, toAcc, amount: t.amount, currency: t.currency, desc: t.description || "Transfer", date: t.date }, { by: owner, source })));
  }
  if (!items.length) return { saved: [], moves, draft: null };
  if (items.length === 1 && !(items[0].amount > 0)) return { saved: [], moves, draft: { ...items[0], by: items[0].by || by } };
  for (const it of items) {
    if (it.from && accounts.some((a) => a.id === it.from)) continue;
    if (it.from === "none") {
      it.from = null;
      continue;
    }
    const owner = it.by || by;
    const want = it.paidWith || (AT.includes(it.from) ? it.from : null) || (settings.defaultPaid || {})[owner] || "cash";
    it.from = await resolveAcc(settings, accounts, want, owner);
  }
  const saved = await withSync(settings, today, items.map((i) => i.from), () => saveExpenses(settings, items, { by, source }));
  return { saved, moves, draft: null };
}

// src/routes/api.mjs
var api_default = async (req) => {
  try {
    const url = new URL(req.url);
    const route = (url.pathname.match(/\/api\/(.*)$/) || [])[1] || "";
    if (route === "health") return json({ ok: true });
    checkAuth(req);
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const settings = await getSettings();
    const today = body.today && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : url.searchParams.get("today") && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("today")) ? url.searchParams.get("today") : todayIn(settings.timezone);
    if (route === "state" && req.method === "GET") {
      const months = (url.searchParams.get("months") || "").split(",").filter((m) => /^\d{4}-\d{2}$/.test(m));
      const keys = months.length ? months : (() => {
        const cm = today.slice(0, 7);
        const a = [];
        for (let i = 5; i >= 0; i--) a.push(shiftMonth(cm, -i));
        return a;
      })();
      let accounts = null;
      try {
        await mergeDuplicateCash(settings, today);
        accounts = await rollStatements(settings, today);
      } catch (e) {
      }
      const [recurring, income, accounts0, networth, monthKeys, ...docs2] = await Promise.all([getRecurring(), getIncome(), accounts ? Promise.resolve(accounts) : getAccounts(), getNetworthPoints(), listMonthKeys(), ...keys.map((k) => getMonth(k))]);
      accounts = accounts0;
      const mv = await Promise.all(keys.map((k) => getMoves(k)));
      const out = {}, moves = {};
      keys.forEach((k, i) => {
        out[k] = docs2[i];
        moves[k] = mv[i];
      });
      let recon = {};
      try {
        recon = await reconcile(settings, accounts, today, { months: out, moves });
      } catch (e) {
      }
      let check = null;
      try {
        check = await monthCheck(settings, today.slice(0, 7), accounts, networth, today);
      } catch (e) {
      }
      return json({ settings, recurring, income, accounts, networth, recon, check, months: out, moves, monthKeys, today, serverTime: Date.now() });
    }
    if (route === "month" && req.method === "GET") {
      const mk = url.searchParams.get("m");
      if (!/^\d{4}-\d{2}$/.test(mk || "")) throw new HttpError(400, "Bad month");
      const [items, moves] = await Promise.all([getMonth(mk), getMoves(mk)]);
      return json({ month: mk, items, moves });
    }
    if (route === "expense" && req.method === "POST") {
      const by = String(body.by || "").slice(0, 40);
      let items, via = "manual";
      const accounts = await getAccounts();
      if (body.text) {
        const r2 = await parseNote(settings, String(body.text).slice(0, 500), today);
        items = r2.items;
        via = r2.via;
      } else if (body.expense) {
        const e = body.expense;
        items = [{ amount: Number(e.amount) || 0, currency: CURRENCIES.includes(e.currency) ? e.currency : settings.base, description: String(e.desc || e.description || "").slice(0, 80) || "Expense", tag: TAGS.includes(e.tag) ? e.tag : "Other", date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date : today, by: e.by || null, note: e.note ? String(e.note).slice(0, 200) : null, from: e.from === "none" ? "none" : e.from || null }];
      } else throw new HttpError(400, "Send text or expense");
      const r = await bookItems(settings, items, { by, source: body.source || (body.text ? "text" : "manual"), today, accounts });
      if (r.draft) return json({ saved: [], moves: r.moves, draft: r.draft, via });
      return json({ saved: r.saved, moves: r.moves, via });
    }
    if (route === "expense" && req.method === "PUT") {
      const e = body.expense || {};
      const from = String(body.month || e.month || "");
      if (!e.id || !/^\d{4}-\d{2}$/.test(from)) throw new HttpError(400, "Need id and month");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date : today;
      const to = date.slice(0, 7);
      const cur = CURRENCIES.includes(e.currency) ? e.currency : settings.base;
      const old = (await getMonth(from)).find((x) => x.id === e.id);
      if (!old) throw new HttpError(404, "Expense not found");
      let newFrom = e.from === void 0 ? old.from || null : e.from || null;
      if (newFrom === "none") newFrom = null;
      else if (newFrom === "auto") {
        const accs = await getAccounts();
        const owner = e.by || old.by || body.by || "";
        newFrom = await resolveAcc(settings, accs, (settings.defaultPaid || {})[owner] || "cash", owner);
      }
      const doc = { ...old, amount: Number(e.amount) || 0, currency: cur, usd: toUSD(settings, e.amount, cur), desc: String(e.desc || "").slice(0, 80) || "Expense", tag: TAGS.includes(e.tag) ? e.tag : "Other", by: String(e.by || "").slice(0, 40), date, month: to, note: e.note ? String(e.note).slice(0, 200) : null, from: newFrom };
      await withSync(settings, today, [old.from, newFrom], async () => {
        if (to === from) {
          await mutateList("months/" + from, (items) => items.map((x) => x.id === e.id ? doc : x));
        } else {
          await mutateList("months/" + to, (items) => items.some((x) => x.id === e.id) ? items.map((x) => x.id === e.id ? doc : x) : items.concat([doc]));
          await mutateList("months/" + from, (items) => items.filter((x) => x.id !== e.id));
        }
      });
      return json({ saved: [doc] });
    }
    if (route === "expense" && req.method === "DELETE") {
      const { id, month } = body;
      if (!id || !/^\d{4}-\d{2}$/.test(month || "")) throw new HttpError(400, "Need id and month");
      const ex = (await getMonth(month)).find((x) => x.id === id);
      await withSync(settings, today, ex ? [ex.from] : [], () => mutateList("months/" + month, (items) => items.filter((x) => x.id !== id)));
      return json({ ok: true });
    }
    if (route === "expenses/delete" && req.method === "POST") {
      const list = Array.isArray(body.items) ? body.items.filter((x) => x && x.id && /^\d{4}-\d{2}$/.test(x.month || "")).slice(0, 500) : [];
      if (!list.length) throw new HttpError(400, "Nothing to delete");
      const byMonth = {};
      for (const x of list) {
        (byMonth[x.month] = byMonth[x.month] || /* @__PURE__ */ new Set()).add(String(x.id));
      }
      const fromIds = /* @__PURE__ */ new Set();
      for (const [mk, ids] of Object.entries(byMonth)) {
        (await getMonth(mk)).forEach((x) => {
          if (ids.has(x.id) && x.from) fromIds.add(x.from);
        });
      }
      let removed = 0;
      await withSync(settings, today, [...fromIds], async () => {
        for (const [mk, ids] of Object.entries(byMonth)) {
          await mutateList("months/" + mk, (items) => {
            const keep = items.filter((x) => !ids.has(x.id));
            removed += items.length - keep.length;
            return keep;
          });
        }
      });
      return json({ ok: true, removed });
    }
    if (route === "move" && req.method === "POST") {
      const m = body.move || {};
      const doc = await withSync(settings, today, [m.fromAcc, m.toAcc], () => saveMove(settings, { id: m.id, kind: MOVE_KINDS.includes(m.kind) ? m.kind : "transfer", fromAcc: m.fromAcc || null, toAcc: m.toAcc || null, amount: m.amount, currency: CURRENCIES.includes(m.currency) ? m.currency : settings.base, desc: m.desc, date: /^\d{4}-\d{2}-\d{2}$/.test(m.date || "") ? m.date : today, incomeId: m.incomeId || null, note: m.note, ts: m.ts }, { by: body.by || m.by || "", source: "manual" }));
      return json({ saved: doc });
    }
    if (route === "move" && req.method === "DELETE") {
      const { id, month } = body;
      if (!id || !/^\d{4}-\d{2}$/.test(month || "")) throw new HttpError(400, "Need id and month");
      const mv = (await getMoves(month)).find((x) => x.id === id);
      await withSync(settings, today, mv ? [mv.fromAcc, mv.toAcc] : [], () => deleteMove(month, id));
      return json({ ok: true });
    }
    if (route === "account/confirm" && req.method === "POST") {
      const { id, amount } = body;
      if (!id) throw new HttpError(400, "Need id");
      const accounts = await getAccounts();
      const acc = accounts.find((a) => a.id === id);
      if (!acc) throw new HttpError(404, "No such account");
      const extra = acc.type === "card" && Number(acc.limit) > 0 ? { available: Math.max(0, Number(acc.limit) - Number(amount)) } : {};
      const r = await confirmBalance(settings, id, Number(amount) || 0, today, extra);
      const recon = await reconcile(settings, r.accounts, today);
      return json({ accounts: r.accounts, recon, networth: await getNetworthPoints() });
    }
    if (route === "account/resolve" && req.method === "POST") {
      const { id, action } = body;
      const accounts = await getAccounts();
      const acc = accounts.find((a) => a.id === id);
      if (!acc) throw new HttpError(404, "No such account");
      const recon = await reconcile(settings, accounts, today);
      const gap = recon[id] ? recon[id].gap : 0;
      if (!gap) return json({ accounts, recon, ok: true });
      const liab = acc.type === "card";
      const missingOut = liab ? gap > 0 : gap < 0;
      const amount = Math.abs(gap);
      const owner = acc.owner && acc.owner !== "Joint" ? acc.owner : body.by || "";
      if (action === "withdrawal" && missingOut && !liab) {
        const cash = await accountOfType(settings, accounts, "cash", owner, { create: true, currency: "USD" });
        await withSync(settings, today, [cash ? cash.id : null], () => saveMove(settings, { kind: "transfer", fromAcc: acc.id, toAcc: cash ? cash.id : null, amount, currency: acc.currency, desc: "Cash withdrawal (reconciled)", date: today }, { by: owner, source: "resolve" }));
      } else if (action === "withdrawal" && !missingOut && acc.type === "cash") {
        const bank = await accountOfType(settings, accounts, "bank", owner);
        const ts = bank && bank.confirmed && bank.confirmed.ts ? Math.min(Date.now(), bank.confirmed.ts - 1) : Date.now();
        await saveMove(settings, { kind: "transfer", fromAcc: bank ? bank.id : null, toAcc: acc.id, amount, currency: acc.currency, desc: "Cash withdrawal (reconciled)", date: today, ts }, { by: owner, source: "resolve" });
      } else if (action === "expense" && missingOut) {
        await saveExpenses(settings, [{ amount, currency: acc.currency, description: body.desc ? String(body.desc).slice(0, 80) : "Untracked spending", tag: TAGS.includes(body.tag) ? body.tag : "Other", date: today, by: owner || null, note: "Added to explain a balance gap", from: acc.id }], { by: owner, source: "resolve" });
      } else if (action === "fee" && missingOut) {
        await saveExpenses(settings, [{ amount, currency: acc.currency, description: "Bank fees / interest", tag: "Fees", date: today, by: owner || null, note: "Added to explain a balance gap", from: acc.id }], { by: owner, source: "resolve" });
      } else {
        await saveMove(settings, { kind: "adjust", fromAcc: missingOut ? acc.id : null, toAcc: missingOut ? null : acc.id, amount, currency: acc.currency, desc: "Balance adjustment", date: today }, { by: owner, source: "resolve" });
      }
      const accounts2 = await advanceBaseline(id, today);
      const recon2 = await reconcile(settings, accounts2, today);
      return json({ accounts: accounts2, recon: recon2, ok: true });
    }
    if (route === "income" && req.method === "POST") {
      const r = body.item || {};
      const doc = { id: r.id || newId(), name: String(r.name || "").slice(0, 60) || "Income", amount: Number(r.amount) || 0, currency: CURRENCIES.includes(r.currency) ? r.currency : settings.base, period: r.period === "yearly" ? "yearly" : "monthly", by: String(r.by || "").slice(0, 40), active: r.active !== false, ts: r.ts || Date.now() };
      const items = await mutateList("income", (items2) => {
        const i = items2.findIndex((x) => x.id === doc.id);
        if (i >= 0) items2[i] = doc;
        else items2.push(doc);
        return items2;
      });
      return json({ saved: doc, income: items });
    }
    if (route === "income" && req.method === "DELETE") {
      const items = await mutateList("income", (items2) => items2.filter((x) => x.id !== body.id));
      return json({ income: items });
    }
    if (route === "account" && req.method === "POST") {
      const a = body.item || {};
      const type = ACCOUNT_TYPES.includes(a.type) ? a.type : "bank";
      const prev = (await getAccounts()).find((x) => x.id === a.id) || null;
      const doc = { id: a.id || newId(), name: String(a.name || "").slice(0, 60) || "Account", type, owner: String(a.owner || "").slice(0, 40), amount: Math.abs(Number(a.amount)) || 0, currency: CURRENCIES.includes(a.currency) ? a.currency : settings.base, grams: type === "gold" ? Math.abs(Number(a.grams)) || 0 : null, limit: type === "card" ? Math.abs(Number(a.limit)) || null : null, available: type === "card" && a.available !== "" && a.available != null ? Math.abs(Number(a.available)) || 0 : null, last4: a.last4 ? String(a.last4).replace(/\D/g, "").slice(-4) || null : null, mask: a.mask ? String(a.mask).trim().slice(0, 30) || null : null, bucket: a.bucket === "saved" || a.bucket === "spending" ? a.bucket : prev ? prev.bucket || null : null, note: a.note ? String(a.note).slice(0, 120) : null, active: a.active !== false, updatedAt: today, ts: a.ts || Date.now(), confirmed: prev ? prev.confirmed || null : null };
      if (type === "card" && doc.limit && doc.available != null) doc.amount = Math.round((doc.limit - Math.min(doc.limit, doc.available)) * 100) / 100;
      const isFlow = ["cash", "bank", "savings", "card"].includes(type);
      if (isFlow && !prev) doc.confirmed = { amount: doc.amount, date: today, ts: Date.now() };
      let items = await mutateList("accounts", (items2) => {
        const i = items2.findIndex((x) => x.id === doc.id);
        if (i >= 0) items2[i] = prev && isFlow ? { ...doc, amount: prev.amount } : doc;
        else items2.push(doc);
        return items2;
      });
      if (isFlow && prev && Math.abs((prev.amount || 0) - doc.amount) > 4e-3) {
        const r = await confirmBalance(settings, doc.id, doc.amount, today, type === "card" ? { available: doc.available } : {});
        if (r) items = r.accounts;
      }
      const networth = await recordSnapshot(settings, items, today);
      const recon = await reconcile(settings, items, today);
      return json({ saved: items.find((x) => x.id === doc.id) || doc, accounts: items, networth, recon });
    }
    if (route === "account" && req.method === "DELETE") {
      const items = await mutateList("accounts", (items2) => items2.filter((x) => x.id !== body.id));
      const networth = await recordSnapshot(settings, items, today);
      const recon = await reconcile(settings, items, today);
      return json({ accounts: items, networth, recon });
    }
    if (route === "recurring" && req.method === "POST") {
      const r = body.item || {};
      const doc = { id: r.id || newId(), name: String(r.name || "").slice(0, 60) || "Untitled", amount: Number(r.amount) || 0, currency: CURRENCIES.includes(r.currency) ? r.currency : settings.base, period: r.period === "yearly" ? "yearly" : "monthly", kind: String(r.kind || "other"), by: String(r.by || "").slice(0, 40), day: Number(r.day) || null, active: r.active !== false, ts: r.ts || Date.now() };
      const items = await mutateList("recurring", (items2) => {
        const i = items2.findIndex((x) => x.id === doc.id);
        if (i >= 0) items2[i] = doc;
        else items2.push(doc);
        return items2;
      });
      return json({ saved: doc, recurring: items });
    }
    if (route === "recurring" && req.method === "DELETE") {
      const items = await mutateList("recurring", (items2) => items2.filter((x) => x.id !== body.id));
      return json({ recurring: items });
    }
    if (route === "settings" && req.method === "PUT") {
      const s = body.settings || {};
      const members = Array.isArray(s.members) ? s.members.map((x) => String(x).trim().slice(0, 30)).filter(Boolean) : settings.members;
      const people = Array.isArray(s.people) ? s.people.map((x) => String(x).trim().slice(0, 30)).filter(Boolean) : settings.people || [];
      const cashRules = Array.isArray(s.cashRules) ? s.cashRules.map((x) => String(x).trim().slice(0, 40)).filter(Boolean) : settings.cashRules || DEFAULT_SETTINGS.cashRules;
      const defaultPaid = {};
      if (s.defaultPaid && typeof s.defaultPaid === "object") {
        for (const [k, v] of Object.entries(s.defaultPaid)) {
          if (["cash", "bank", "card", "savings"].includes(v)) defaultPaid[String(k).slice(0, 30)] = v;
        }
      }
      const doc = { members: members.length ? members : DEFAULT_SETTINGS.members, people, base: CURRENCIES.includes(s.base) ? s.base : settings.base, rates: { USD: 1, LBP: Number(s.rates?.LBP) || settings.rates.LBP, EUR: Number(s.rates?.EUR) || settings.rates.EUR, AED: Number(s.rates?.AED) || settings.rates.AED || 3.6725 }, budget: Number(s.budget) || null, timezone: String(s.timezone || settings.timezone || "Asia/Beirut"), goldPrice: Number(s.goldPrice) || null, cashRules, defaultPaid };
      await writeJSON("settings", doc);
      if (doc.goldPrice !== settings.goldPrice) {
        try {
          await recordSnapshot(doc, await getAccounts(), today);
        } catch (e) {
        }
      }
      return json({ settings: doc });
    }
    if (route === "analyze" && req.method === "POST") {
      const sel = (Array.isArray(body.months) ? body.months : [body.month]).filter((m) => /^\d{4}-\d{2}$/.test(m || "")).sort().slice(-24);
      const months = sel.length ? sel : [today.slice(0, 7)];
      const [recurring, income, accounts] = await Promise.all([getRecurring(), getIncome(), getAccounts()]);
      const incomeUSD = incomeMonthlyUSD(settings, income);
      const nw = netWorth(settings, accounts);
      nw.liquid = accounts.filter((a) => a.active !== false && ["cash", "bank", "savings"].includes(a.type) && bucketOf(a) === "spending").reduce((t, a) => t + accountUSD(settings, a), 0);
      nw.saved = accounts.filter((a) => a.active !== false && !LIABILITY_TYPES.includes(a.type) && bucketOf(a) === "saved").reduce((t, a) => t + accountUSD(settings, a), 0);
      try {
        const ck = await monthCheck(settings, today.slice(0, 7), accounts, [], today);
        nw.savedThisMonth = ck.savedUSD;
      } catch (e) {
      }
      let p;
      if (months.length === 1) {
        const mk = months[0];
        const [cur, m1, m2] = await Promise.all([getMonth(mk), getMonth(shiftMonth(mk, -1)), getMonth(shiftMonth(mk, -2))]);
        const st = monthStats(settings, cur, recurring, mk, today), s1 = monthStats(settings, m1, recurring, shiftMonth(mk, -1), today), s2 = monthStats(settings, m2, recurring, shiftMonth(mk, -2), today);
        if (!st.count && !recurring.length) return text("Nothing to analyze yet. Log a few expenses first.");
        p = analysisPrompt(settings, mk, st, s1, s2, recurring, today, incomeUSD, nw);
      } else {
        const n = months.length;
        const priorKeys = [];
        for (let i = n; i >= 1; i--) priorKeys.push(shiftMonth(months[0], -i));
        const docs2 = await Promise.all([...months, ...priorKeys].map((k) => getMonth(k)));
        const perMonth = months.map((mk, i) => ({ mk, st: monthStats(settings, docs2[i], recurring, mk, today) }));
        const prior = { total: 0, byTag: {} };
        priorKeys.forEach((mk, i) => {
          const st = monthStats(settings, docs2[n + i], recurring, mk, today);
          prior.total += st.total;
          for (const [t, v] of Object.entries(st.byTag)) prior.byTag[t] = (prior.byTag[t] || 0) + v;
        });
        if (!perMonth.some((x) => x.st.count) && !recurring.length) return text("Nothing to analyze yet. Log a few expenses first.");
        p = rangeAnalysisPrompt(settings, perMonth, prior, recurring, incomeUSD, nw);
      }
      const up = await claudeMessage({ model: analysisModel(), system: p.system, messages: [{ role: "user", content: p.user }], max_tokens: 700, stream: true });
      const dec = new TextDecoder(), enc = new TextEncoder();
      let buf = "";
      const stream = new ReadableStream({ async start(ctl) {
        const reader = up.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (!line.startsWith("data:")) continue;
              try {
                const ev = JSON.parse(line.slice(5));
                if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") ctl.enqueue(enc.encode(ev.delta.text));
                if (ev.type === "error") ctl.enqueue(enc.encode("\n[Claude error: " + (ev.error?.message || "unknown") + "]"));
              } catch (e) {
              }
            }
          }
        } catch (e) {
          ctl.enqueue(enc.encode("\n[interrupted]"));
        }
        ctl.close();
      } });
      return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
    }
    throw new HttpError(404, "No such route");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e.message || "Server error" }, status);
  }
};

// src/routes/sms.mjs
async function readAlert(settings, sms, today) {
  const system = `You read one bank or card alert SMS and extract what happened. Reply with only JSON, no prose, no code fences.
Today: ${today} (${weekdayIn(settings.timezone)}). Currencies in use: USD, LBP (Lebanese lira), EUR, AED (UAE dirhams).
Tags, pick exactly one for purchases: ${TAGS.join(", ")}.
Shape: {"kind": "purchase"|"withdrawal"|"credit_in"|"card_payment"|"fee"|"refund"|"declined"|"otp"|"other", "amount": number, "currency": "USD"|"LBP"|"EUR"|"AED", "account": "card"|"bank"|null, "card_last4": string|null, "account_mask": string|null, "merchant": string, "description": string, "tag": string, "date": "YYYY-MM-DD", "available": number|null, "available_kind": "limit"|"balance"|null, "available_currency": "USD"|"LBP"|"EUR"|"AED"|null}
How to read it:
- account is the account whose balance the alert reports: "card" when it ends with "available limit" (a credit card); "bank" when it ends with "available balance" or names an account number like 032-401***-001 (a current/savings account), even if the text mentions a credit card as the payee ("Payment to Credit Card ending 9821 from 032-401***-001 \u2026 available balance" is account "bank", kind "card_payment").
- kind: "purchase" = money spent at a merchant (a credit-card use, or a debit "Purchase from <account> \u2026 AED 123.45-"); "withdrawal" = ATM / cash withdrawal; "credit_in" = money received into the account (an amount with a trailing "+", "TT Payment to <account>", salary, transfer in); "card_payment" = a payment to or received on a credit card; "fee" = bank fee, interest, charges; "refund" = reversal/refund; "declined", "otp" (one-time code), "other" (balance notice, promotions, reminders).
- amount is the transaction amount in its own currency (a credit card used for LBP 122,950,000.00 has amount 122950000 and currency LBP even if the available limit is in AED). Never use the available balance or limit as the amount.
- available is the figure after "Your available limit is" (available_kind "limit", a credit card) or "Your available balance is" (available_kind "balance", a bank account), with its currency; null if absent.
- card_last4: digits after "ending with" / "Card Ending with"; account_mask: the masked account number exactly as written (e.g. 032-401***-001).
- merchant is the raw merchant text; description is a clean 2-5 word Title Case name (ZARA \u2192 Zara; PATCHI DBAYE \u2192 Patchi Dbaye; Careem Deliveries FZ \u2192 Careem Deliveries). date is the transaction date in the SMS (DD/MM/YYYY) as YYYY-MM-DD, else today.`;
  const res = await claudeMessage({ model: parseModel(), system, max_tokens: 350, messages: [{ role: "user", content: `SMS: """${sms.replace(/"""/g, '"')}"""` }] });
  const data = await res.json();
  const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, "Claude did not return JSON.");
  return JSON.parse(m[0]);
}
function readAlertLocal(sms, today) {
  const money = sms.match(/\b(AED|USD|LBP|EUR)\s*([\d,]+(?:\.\d+)?)\s*([+-])?/i);
  if (!money) return { kind: /code|OTP|password/i.test(sms) ? "otp" : "other" };
  const currency = money[1].toUpperCase(), amount = parseFloat(money[2].replace(/,/g, "")), sign = money[3] || "";
  const av = sms.match(/available\s+(limit|balance)\s+is\s+(AED|USD|LBP|EUR)\s*([\d,]+(?:\.\d+)?)/i);
  const last4 = (sms.match(/(?:ending with|Card Ending with)\s*\**\s*(\d{4})\b/i) || [])[1] || null;
  const mask = (sms.match(/\b(\d{3}-\d{3}\*+-\d{3})\b/) || [])[1] || null;
  const d = sms.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const date = d ? `${d[3]}-${d[2]}-${d[1]}` : today;
  const account = av ? av[1].toLowerCase() === "limit" ? "card" : "bank" : /your credit card/i.test(sms) ? "card" : mask ? "bank" : null;
  let kind = "other", merchant = "";
  if (/code|OTP|password/i.test(sms)) kind = "otp";
  else if (/declined/i.test(sms)) kind = "declined";
  else if (/refund|revers/i.test(sms)) kind = "refund";
  else if (/ATM|cash withdrawal/i.test(sms)) kind = "withdrawal";
  else if (/payment (?:to|received on) .*credit card|credit card payment/i.test(sms)) kind = "card_payment";
  else if (sign === "+" || /payment to \d{3}-\d{3}|credited|salary/i.test(sms)) kind = "credit_in";
  else if (/has been used for|was used for|used for|purchase from|purchase of|spent/i.test(sms) || sign === "-") kind = "purchase";
  else if (/fee|interest|charge/i.test(sms)) kind = "fee";
  const at = sms.match(/\bat\s+([A-Z0-9][^.\n]{1,40}?)(?=\.\s|\.$|\s+on\b)/i);
  if (at) merchant = at[1].trim();
  else {
    const pf = sms.match(/\d{2}:\d{2}:\d{2}\s+(.+?)\s+Purchase from/i);
    if (pf) merchant = pf[1].trim();
  }
  const desc = merchant ? merchant.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+(fz|llc|dmcc|ltd)\b/i, "") : kind === "credit_in" ? "Money received" : "Card payment";
  return { kind, amount, currency, account, card_last4: last4, account_mask: mask, merchant, description: desc, tag: guessTag(merchant), date, available: av ? parseFloat(av[3].replace(/,/g, "")) : null, available_kind: av ? av[1].toLowerCase() : null, available_currency: av ? av[2].toUpperCase() : null };
}
var sms_default = async (req) => {
  try {
    checkAuth(req);
    const url = new URL(req.url);
    let sms = url.searchParams.get("text") || "";
    let by = url.searchParams.get("by") || "";
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const b = await req.json().catch(() => ({}));
        sms = b.text || sms;
        by = b.by || by;
      } else if (ct.includes("form")) {
        const f = await req.formData().catch(() => null);
        if (f) {
          sms = f.get("text") || sms;
          by = f.get("by") || by;
        }
      } else {
        const t = await req.text().catch(() => "");
        if (t && !sms) sms = t;
      }
    }
    sms = String(sms || "").trim().slice(0, 1e3);
    if (!sms) return text("No message text received.", 400);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const who = memberName(settings, by) || String(by || "").slice(0, 40);
    let a;
    try {
      a = await readAlert(settings, sms, today);
    } catch (e) {
      a = readAlertLocal(sms, today);
    }
    if (["otp", "declined", "other"].includes(a.kind) && a.available == null) return text("Ignored: " + (a.kind || "other"));
    const amount = Math.abs(Number(a.amount)) || 0;
    const currency = CURRENCIES.includes(String(a.currency || "").toUpperCase()) ? String(a.currency).toUpperCase() : settings.base;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : today;
    const mk = date.slice(0, 7);
    const accounts = await getAccounts();
    const isCard = a.available_kind === "limit" || a.available_kind !== "balance" && a.account === "card";
    const acc = isCard ? matchCardAcc(accounts, { last4: a.card_last4, owner: who }) : matchBank(accounts, { mask: a.account_mask, last4: a.card_last4, owner: who });
    const accName = acc ? acc.name : isCard ? "credit card" : "bank account";
    const notes = [];
    const recentExp = await getMonth(mk), recentMv = await getMoves(mk);
    const dup = amount > 0 && (recentExp.some((e) => Math.abs(e.amount - amount) < 5e-3 && e.currency === currency && Date.now() - e.ts < 10 * 60 * 1e3) || recentMv.some((m) => Math.abs(m.amount - amount) < 5e-3 && m.currency === currency && Date.now() - m.ts < 10 * 60 * 1e3));
    let headline = "";
    if (!dup && amount > 0) {
      const kind = a.kind === "purchase" && !isCard && isCashOut(settings, a.merchant || a.description) ? "withdrawal" : a.kind;
      const raw = "sms|" + kind + "|" + String(a.merchant || "").slice(0, 60) + "|" + amount + "|" + currency;
      if (kind === "purchase" || kind === "fee") {
        const items = [{ amount, currency, description: String(a.description || a.merchant || "Card payment").slice(0, 80), tag: kind === "fee" ? "Fees" : TAGS.includes(a.tag) ? a.tag : guessTag(String(a.merchant || "")), date, by: null, note: isCard ? "Card alert" : "Bank alert", from: acc ? acc.id : null, raw }];
        const s = (await withSync(settings, today, [acc ? acc.id : null], () => saveExpenses(settings, items, { by: who, source: "sms" })))[0];
        headline = `Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by ? " for " + s.by : ""}${acc ? " from " + acc.name : ""}.`;
      } else if (kind === "withdrawal") {
        const cash = await accountOfType(settings, accounts, "cash", who, { create: true, currency: "USD" });
        const m = await withSync(settings, today, [acc ? acc.id : null, cash ? cash.id : null], () => saveMove(settings, { kind: "transfer", fromAcc: acc ? acc.id : null, toAcc: cash ? cash.id : null, amount, currency, desc: "Cash withdrawal" + (a.merchant ? " via " + String(a.description || a.merchant).slice(0, 30) : ""), date, raw }, { by: who, source: "sms" }));
        headline = `Moved ${fmt(settings, m.usd)} from ${accName} to ${cash ? cash.name : "cash in hand"}.`;
      } else if (kind === "credit_in") {
        const income = await getIncome();
        const usd = toUSD(settings, amount, currency);
        const cands = income.filter((i) => i.active !== false && i.period === "monthly" && (!i.by || !who || String(i.by).toLowerCase() === String(who).toLowerCase()));
        const hit = cands.find((i) => {
          const u = toUSD(settings, i.amount, i.currency);
          return u > 0 && Math.abs(usd - u) / u <= 0.2;
        });
        const already = hit && recentMv.some((m2) => m2.kind === "income" && m2.incomeId === hit.id);
        const m = await withSync(settings, today, [acc ? acc.id : null], () => saveMove(settings, { kind: hit ? "income" : "adjust", fromAcc: null, toAcc: acc ? acc.id : null, amount, currency, desc: hit ? already ? hit.name + " (again)" : hit.name : "Money received" + (a.description && a.description !== "Money received" ? " \xB7 " + String(a.description).slice(0, 40) : ""), date, incomeId: hit ? hit.id : null, raw }, { by: who, source: "sms" }));
        headline = hit ? `${hit.name} received: ${fmt(settings, m.usd)} into ${accName}.` : `${fmt(settings, m.usd)} received into ${accName} (not matched to a salary; it counts as an adjustment).`;
      } else if (kind === "card_payment") {
        const card = isCard ? acc : matchCardAcc(accounts, { last4: a.card_last4, owner: who });
        const bank = isCard ? matchBank(accounts, { owner: who }) : acc;
        const m = await withSync(settings, today, [bank ? bank.id : null, card ? card.id : null], () => saveMove(settings, { kind: "transfer", fromAcc: bank ? bank.id : null, toAcc: card ? card.id : null, amount, currency, desc: "Credit card payment", date, raw }, { by: who, source: "sms" }));
        headline = `Card payment of ${fmt(settings, m.usd)} recorded${bank ? " from " + bank.name : ""}${card ? " to " + card.name : ""}.`;
      } else if (kind === "refund") {
        const m = await withSync(settings, today, [acc ? acc.id : null], () => saveMove(settings, { kind: "refund", fromAcc: null, toAcc: acc ? acc.id : null, amount, currency, desc: "Refund" + (a.description ? " \xB7 " + String(a.description).slice(0, 40) : ""), date, raw }, { by: who, source: "sms" }));
        headline = `Refund of ${fmt(settings, m.usd)} into ${accName}.`;
      }
    } else if (dup) headline = "Already logged.";
    if (acc && a.available != null && Number(a.available) >= 0) {
      if (acc.type === "card" && !(Number(acc.limit) > 0)) notes.push(`Set the credit limit on ${acc.name} in Wealth so alerts can update its debt.`);
      else if (a.available_currency && acc.currency && a.available_currency !== acc.currency) notes.push(`Reading in ${a.available_currency} ignored: ${acc.name} is in ${acc.currency}.`);
      else {
        try {
          const r = await applyReading(settings, acc, Number(a.available), a.available_currency || null, today);
          if (r) notes.push(acc.type === "card" ? `Card debt now ${fmtAmount(r.account.amount, acc.currency)}.` : `${acc.name} balance now ${fmtAmount(r.account.amount, acc.currency)}.`);
        } catch (e) {
        }
      }
    } else if (!acc && a.available != null) {
      notes.push(isCard ? "No credit-card account matched this alert; add one in Wealth with the card's last digits." : "No bank account matched this alert; add one in Wealth with the account number mask.");
    }
    const reply = (headline || "Nothing to add.") + (notes.length ? " " + notes.join(" ") : "");
    console.log("[sms]", JSON.stringify({ kind: a.kind, amount, currency, account: acc ? acc.name : null, isCard, available: a.available, dup, reply }));
    return text(reply);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.log("[sms] error", status, e.message);
    return text(status === 401 ? "The household key is wrong." : "Could not save: " + (e.message || "server error"), status);
  }
};

// src/routes/pay.mjs
function parseMoney(s, fallback) {
  s = String(s || "").trim();
  if (!s) return { amount: 0, currency: fallback };
  let currency = null;
  if (/\$/.test(s) || /\bUSD\b/i.test(s)) currency = "USD";
  else if (/€/.test(s) || /\bEUR\b/i.test(s)) currency = "EUR";
  else if (/\bAED\b|د\.إ|\bDH\b/i.test(s)) currency = "AED";
  else if (/\bLBP\b|L\.L\.?|\bLL\b|ل\.ل/i.test(s)) currency = "LBP";
  const m = s.match(/-?\d[\d.,\s]*/);
  if (!m) return { amount: 0, currency: currency || fallback };
  let num = m[0].replace(/\s/g, "");
  const lastDot = num.lastIndexOf("."), lastComma = num.lastIndexOf(",");
  const commaDecimal = lastComma > lastDot && (num.match(/,/g) || []).length === 1 && /,\d{1,2}$/.test(num);
  if (commaDecimal) {
    num = num.replace(/\./g, "").replace(",", ".");
  } else {
    num = num.replace(/,/g, "");
  }
  return { amount: Math.abs(parseFloat(num)) || 0, currency: currency || fallback };
}
var pay_default = async (req) => {
  try {
    checkAuth(req);
    const url = new URL(req.url);
    const q = (k) => url.searchParams.get(k) || "";
    let merchant = q("merchant"), amountText = q("amount"), card = q("card"), by = q("by"), status = q("status");
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      let b = {};
      if (ct.includes("json")) b = await req.json().catch(() => ({}));
      else if (ct.includes("form")) {
        const f = await req.formData().catch(() => null);
        if (f) for (const [k, v] of f.entries()) b[k] = v;
      }
      merchant = b.merchant || merchant;
      amountText = b.amount != null ? String(b.amount) : amountText;
      card = b.card || card;
      by = b.by || by;
      status = b.status || status;
    }
    merchant = String(merchant || "").trim().slice(0, 120);
    card = String(card || "").trim().slice(0, 60);
    if (/refund|declined|failed|reversed/i.test(status)) return text("Ignored: " + status);
    const settings = await getSettings();
    const money = parseMoney(amountText, settings.base);
    if (!(money.amount > 0)) return text("No amount received.", 400);
    const today = todayIn(settings.timezone);
    const mk = today.slice(0, 7);
    const dup = (await getMonth(mk)).some((e) => Math.abs(e.amount - money.amount) < 5e-3 && e.currency === money.currency && Date.now() - e.ts < 10 * 60 * 1e3);
    if (dup) return text("Already logged.");
    const who = memberName(settings, by) || String(by || "").slice(0, 40);
    const note = `${money.currency} ${money.amount} at ${merchant || "card payment"}`;
    let items;
    try {
      const r = await parseNote(settings, note, today);
      items = r.items;
    } catch (e) {
      items = null;
    }
    if (!items || !items.length || !(items[0].amount > 0)) items = [{ amount: money.amount, currency: money.currency, description: merchant || "Card payment", tag: guessTag(merchant), date: today, by: null, note: null }];
    const accounts = await getAccounts();
    const l4 = (card.match(/(\d{4})(?!.*\d)/) || [])[1] || null;
    const byL4 = l4 ? accounts.find((a) => a.active !== false && (a.type === "card" || a.type === "bank") && String(a.last4 || "") === l4) : null;
    const acc = byL4 || matchCardAcc(accounts, { last4: null, owner: who });
    items = [{ ...items[0], kind: "expense", amount: money.amount, currency: CURRENCIES.includes(money.currency) ? money.currency : settings.base, by: items[0].by || null, note: card ? "Apple Pay \xB7 " + card : "Apple Pay", from: acc ? acc.id : null, raw: merchant + "|" + money.amount + "|" + money.currency }];
    const saved = await withSync(settings, today, [acc ? acc.id : null], () => saveExpenses(settings, items, { by: who, source: "applepay" }));
    const s = saved[0];
    console.log("[pay]", JSON.stringify({ merchant, amount: money.amount, currency: money.currency, desc: s.desc, tag: s.tag }));
    return text(`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by ? " for " + s.by : ""}.`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return text(status === 401 ? "The household key is wrong." : "Could not save: " + (e.message || "server error"), status);
  }
};

// src/routes/siri.mjs
var siri_default = async (req) => {
  try {
    checkAuth(req);
    const url = new URL(req.url);
    let note = url.searchParams.get("text") || "";
    let by = url.searchParams.get("by") || "";
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const b = await req.json().catch(() => ({}));
        note = b.text || note;
        by = b.by || by;
      } else if (ct.includes("form")) {
        const f = await req.formData().catch(() => null);
        if (f) {
          note = f.get("text") || note;
          by = f.get("by") || by;
        }
      } else {
        const t = await req.text().catch(() => "");
        if (t && !note) note = t;
      }
    }
    note = String(note).trim().slice(0, 500);
    if (!note) return text("I didn't catch an expense. Say the amount and what it was for.");
    const settings = await getSettings();
    const who = memberName(settings, by) || String(by || "").slice(0, 40);
    const today = todayIn(settings.timezone);
    const { items } = await parseNote(settings, note, today);
    const r = await bookItems(settings, items, { by: who, source: "siri", today });
    if (r.draft) return text(`I heard "${note}" but couldn't find an amount. Try again with the number first.`);
    const parts = [];
    for (const m of r.moves) parts.push(`Moved ${fmt(settings, m.usd)}, ${m.desc}.`);
    if (r.saved.length === 1) {
      const s = r.saved[0];
      parts.push(`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by ? " for " + s.by : ""}.`);
    } else if (r.saved.length > 1) {
      const total = r.saved.reduce((a, s) => a + s.usd, 0);
      parts.push(`Added ${r.saved.length} expenses, ${fmt(settings, total)} in total: ` + r.saved.map((s) => `${fmt(settings, s.usd)} ${s.desc}`).join(", ") + ".");
    }
    return text(parts.join(" ") || "Nothing to add.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return text(status === 401 ? "The household key in the shortcut is wrong." : "Could not save: " + (e.message || "server error"), status);
  }
};

// src/worker.mjs
var LedgerStore = defineLedgerStore(DurableObject);
async function importFrom(base, { force = false } = {}) {
  const s = store();
  const key = envVar("HOUSEHOLD_KEY");
  base = String(base || "").replace(/\/+$/, "");
  if (!base || !key) return { skipped: "no address or key" };
  if (!force) {
    const lock = await s.setJSON("meta/import", { state: "running", from: base, at: (/* @__PURE__ */ new Date()).toISOString() }, { onlyIfNew: true });
    if (lock && lock.modified === false) return { skipped: "already imported" };
  }
  const H = { "x-ledger-key": key };
  const get = async (path) => {
    const r = await fetch(base + path, { headers: H });
    if (!r.ok) throw new Error(`${path} \u2192 ${r.status}`);
    return r.json();
  };
  try {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const st = await get("/api/state?today=" + today);
    const written = [];
    if (st.settings) {
      await s.setJSON("settings", st.settings);
      written.push("settings");
    }
    for (const k of ["recurring", "income", "accounts"]) {
      if (Array.isArray(st[k])) {
        await s.setJSON(k, { items: st[k] });
        written.push(k);
      }
    }
    if (Array.isArray(st.networth)) {
      await s.setJSON("networth", { points: st.networth });
      written.push("networth");
    }
    const keys = /* @__PURE__ */ new Set([...st.monthKeys || [], ...Object.keys(st.months || {}), ...Object.keys(st.moves || {})]);
    let months = 0;
    for (const mk of [...keys].sort()) {
      let items = st.months && st.months[mk], moves = st.moves && st.moves[mk];
      if (!items || !moves) {
        const m = await get("/api/month?m=" + mk);
        items = items || m.items || [];
        moves = moves || m.moves || [];
      }
      if (items.length) {
        await s.setJSON("months/" + mk, { items });
      }
      if (moves.length) {
        await s.setJSON("moves/" + mk, { items: moves });
      }
      months++;
    }
    const result = { state: "done", from: base, at: (/* @__PURE__ */ new Date()).toISOString(), written, months };
    await s.setJSON("meta/import", result);
    return result;
  } catch (e) {
    await s.setJSON("meta/import", { state: "failed", from: base, at: (/* @__PURE__ */ new Date()).toISOString(), error: String(e.message || e) }).catch(() => {
    });
    throw e;
  }
}
async function ensureImported() {
  const from = envVar("IMPORT_FROM");
  if (!from) return;
  const s = store();
  const meta = await s.get("meta/import", { type: "json" });
  if (meta && meta.state !== "failed") return;
  const hasData = await s.get("settings", { type: "json" });
  if (hasData && !meta) return;
  try {
    await importFrom(from);
  } catch (e) {
    console.log("[import] failed", e.message);
  }
}
var worker_default = {
  async fetch(req, env2, ctx) {
    bindRuntime({ env: env2 });
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/import" && req.method === "POST") {
        checkAuth(req);
        const b = await req.json().catch(() => ({}));
        const r = await importFrom(b.from || envVar("IMPORT_FROM"), { force: true });
        return json(r);
      }
      if (p === "/api/export" && req.method === "GET") {
        checkAuth(req);
        const docs2 = await store().dump();
        return new Response(JSON.stringify({ exported: (/* @__PURE__ */ new Date()).toISOString(), docs: docs2 }), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="ledger-export.json"', "cache-control": "no-store" } });
      }
      if (p === "/api/health") {
        return json({ ok: true, platform: "cloudflare", importedFrom: await store().get("meta/import", { type: "json" }) || null });
      }
      if (p.startsWith("/api/")) {
        await ensureImported();
        return api_default(req);
      }
      if (p === "/sms") return sms_default(req);
      if (p === "/pay") return pay_default(req);
      if (p === "/siri") return siri_default(req);
      if (env2.ASSETS) return env2.ASSETS.fetch(req);
      return text("Not found", 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: e.message || "Server error" }, status);
    }
  }
};
export {
  LedgerStore,
  worker_default as default
};
