// In-browser simulator of the API gateway + microservices, used in Demo mode so the
// hosted dashboard works without a running backend. It follows the same contracts as
// the real services: same paths, request/response bodies, auth rules, validation,
// payment state machine and bank-callback simulator (per-method delay and success rate).

import { history, keyring } from "./store.js";

const DB_KEY = "paygate.demo.db";

// Same knobs as payment.simulator in the payment-service config.
const SIMULATOR = {
  CARD: { min: 2, max: 6, successRate: 90 },
  UPI: { min: 1, max: 3, successRate: 95 },
  NETBANKING: { min: 4, max: 10, successRate: 80 },
};
const FAILURES = {
  CARD: [["CARD_DECLINED", "The card was declined by the issuing bank"], ["INSUFFICIENT_FUNDS", "Insufficient funds"]],
  UPI: [["UPI_TIMEOUT", "The UPI collect request expired"], ["VPA_INVALID", "The VPA could not be verified"]],
  NETBANKING: [["BANK_DOWN", "The bank is not responding"], ["USER_CANCELLED", "The customer cancelled on the bank page"]],
};

const now = () => new Date().toISOString();
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${rand(8)}-${rand(4)}-4${rand(3)}-a${rand(3)}-${rand(12)}`).toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let db = load();

function load() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch { return null; }
}
function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {}
}
function emptyDb() {
  return { merchants: [], apiKeys: [], webhooks: [], customers: [], orders: [], payments: [], cards: [] };
}

class HttpError extends Error {
  constructor(status, errorCode, errorDescription) { super(errorDescription); this.status = status; this.errorCode = errorCode; }
}
const bad = (code, msg) => new HttpError(400, code, msg);

// ---------------- Auth (gateway) ----------------
function b64url(obj) { return btoa(JSON.stringify(obj)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function makeJwt(merchant) {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: merchant.userId, merchantId: merchant.id, role: "MERCHANT_ADMIN", iat: Math.floor(Date.now() / 1000) })}.${rand(43)}`;
}
function merchantFromJwt(headers) {
  const h = headers.Authorization || "";
  if (!h.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Authorization header");
  try {
    const payload = JSON.parse(atob(h.slice(7).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const m = db.merchants.find((x) => x.id === payload.merchantId);
    if (m) return m;
  } catch {}
  throw new HttpError(401, "UNAUTHORIZED", "Invalid or expired token");
}
function merchantFromApiKey(headers) {
  const h = headers.Authorization || "";
  if (!h.startsWith("Basic ")) throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid Authorization header");
  const [keyId, secret] = atob(h.slice(6)).split(":");
  const key = db.apiKeys.find((k) => k.keyId === keyId);
  if (!key || !key.enabled || key.secret !== secret) throw new HttpError(401, "UNAUTHORIZED", "Invalid API key credentials");
  key.lastUsedAt = now();
  return { merchant: db.merchants.find((m) => m.id === key.merchantId), key };
}

// ---------------- Helpers ----------------
const merchantResponse = (m) => ({ id: m.id, name: m.name, email: m.email, businessName: m.businessName, businessType: m.businessType, merchantStatus: m.merchantStatus });
const apiKeyResponse = (k) => ({ id: k.id, keyId: k.keyId, environment: k.environment, enabled: k.enabled, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt });
const webhookResponse = (w, withSecret = false) => ({ id: w.id, targetUrl: w.targetUrl, ...(withSecret ? { webhookSecret: w.webhookSecret } : {}), enabled: w.enabled, eventTypes: w.eventTypes });
const orderResponse = (o) => ({ id: o.id, merchantId: o.merchantId, customerId: o.customerId, receipt: o.receipt, amount: o.amount, status: o.status, attempts: o.attempts, notes: o.notes, expiresAt: o.expiresAt, createdAt: o.createdAt });
function paymentResponse(p) {
  const r = { id: p.id, orderId: p.orderId, merchantId: p.merchantId, amount: p.amount, status: p.status, method: p.method, methodDetails: p.methodDetails, createdAt: p.createdAt };
  if (p.errorCode) { r.errorCode = p.errorCode; r.errorDescription = p.errorDescription; }
  if (p.capturedAt) r.capturedAt = p.capturedAt;
  return r;
}

function newApiKey(merchantId, environment) {
  const prefix = environment === "LIVE" ? "rzp_live_" : "rzp_test_";
  return { id: uuid(), merchantId, keyId: prefix + rand(14), secret: rand(32), environment, enabled: true, lastUsedAt: null, createdAt: now() };
}

function luhn(pan) {
  let sum = 0, alt = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let n = +pan[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function brandOf(pan) {
  if (/^4/.test(pan)) return "VISA";
  if (/^(5[1-5]|2[2-7])/.test(pan)) return "MASTERCARD";
  if (/^3[47]/.test(pan)) return "AMEX";
  return "RUPAY";
}

// ---------------- Payment state machine + bank simulator ----------------
function transition(p, status, extra = {}) {
  Object.assign(p, extra, { status });
  p.transitions = [...(p.transitions || []), { status, at: now() }];
  history.upsert("payments", { ...paymentResponse(p), transitions: p.transitions });
  deliverWebhooks(p, "PAYMENT_STATUS_CHANGED");
}

function deliverWebhooks(p, eventType) {
  const configs = db.webhooks.filter((w) => w.merchantId === p.merchantId && w.enabled &&
    (!w.eventTypes || w.eventTypes === "ALL" || w.eventTypes.split(",").map((s) => s.trim()).includes(eventType)));
  for (const w of configs) {
    const ok = Math.random() > 0.08;
    history.upsert("webhooks", {
      id: uuid(), at: now(), eventType, paymentId: p.id, status: ok ? "DELIVERED" : "RETRYING",
      targetUrl: w.targetUrl, attempts: 1, payloadStatus: p.status,
      signature: `sha256=${rand(40).toLowerCase()}`,
    });
  }
}

function tick() {
  if (!db) return;
  const t = Date.now();
  let changed = false;
  for (const p of db.payments) {
    if (p.status === "AUTHORIZING" && p.resolveAt && p.resolveAt <= t) {
      const cfg = SIMULATOR[p.method] || SIMULATOR.CARD;
      const order = db.orders.find((o) => o.id === p.orderId);
      if (Math.random() * 100 < cfg.successRate) {
        transition(p, "AUTHORIZED");
      } else {
        const [code, desc] = FAILURES[p.method][Math.floor(Math.random() * 2)];
        transition(p, "FAILED", { errorCode: code, errorDescription: desc });
      }
      delete p.resolveAt;
      if (order) history.upsert("orders", orderResponse(order));
      changed = true;
    }
    if (p.status === "CAPTURING" && p.resolveAt && p.resolveAt <= t) {
      const order = db.orders.find((o) => o.id === p.orderId);
      transition(p, "CAPTURED", { capturedAt: now() });
      if (order) { order.status = "PAID"; history.upsert("orders", orderResponse(order)); }
      delete p.resolveAt;
      changed = true;
    }
  }
  if (changed) save();
}
setInterval(tick, 700);

// ---------------- Route table ----------------
const routes = [
  ["POST", /^\/v1\/auth\/signup$/, (b) => {
    if (!b?.name) throw bad("VALIDATION_FAILED", "Name is required");
    if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw bad("VALIDATION_FAILED", "A valid email is required");
    if (!b.password || b.password.length < 8) throw bad("VALIDATION_FAILED", "Password should be at least 8 characters long");
    if (db.merchants.some((m) => m.email.toLowerCase() === b.email.toLowerCase())) throw new HttpError(409, "DUPLICATE_RESOURCE", "A merchant with this email already exists");
    const m = { id: uuid(), userId: uuid(), name: b.name, email: b.email, password: b.password, businessName: b.businessName || null, businessType: b.businessType || null, merchantStatus: "ACTIVE", createdAt: now() };
    db.merchants.push(m);
    return [201, merchantResponse(m)];
  }],
  ["POST", /^\/v1\/auth\/login$/, (b) => {
    const m = db.merchants.find((x) => x.email.toLowerCase() === (b?.email || "").toLowerCase() && x.password === b?.password);
    if (!m) throw new HttpError(401, "UNAUTHORIZED", "Invalid email or password");
    return [200, { accessToken: makeJwt(m) }];
  }],

  ["GET", /^\/v1\/merchants\/api-keys$/, (b, h) => {
    const m = merchantFromJwt(h);
    return [200, db.apiKeys.filter((k) => k.merchantId === m.id).map(apiKeyResponse)];
  }],
  ["POST", /^\/v1\/merchants\/api-keys$/, (b, h) => {
    const m = merchantFromJwt(h);
    const env = b?.environment || "TEST";
    if (!["TEST", "LIVE"].includes(env)) throw bad("VALIDATION_FAILED", "Environment must be TEST or LIVE");
    const k = newApiKey(m.id, env);
    db.apiKeys.push(k);
    return [201, { id: k.id, keyId: k.keyId, keySecret: k.secret, environment: k.environment }];
  }],
  ["POST", /^\/v1\/merchants\/api-keys\/([^/]+)\/rotate$/, (b, h, [keyId]) => {
    const m = merchantFromJwt(h);
    const old = db.apiKeys.find((k) => k.keyId === decodeURIComponent(keyId) && k.merchantId === m.id);
    if (!old) throw new HttpError(404, "RESOURCE_NOT_FOUND", "API key not found");
    old.enabled = false;
    const k = newApiKey(m.id, old.environment);
    db.apiKeys.push(k);
    return [200, { id: k.id, keyId: k.keyId, keySecret: k.secret, environment: k.environment }];
  }],

  ["GET", /^\/v1\/merchants\/webhooks$/, (b, h) => {
    const m = merchantFromJwt(h);
    return [200, db.webhooks.filter((w) => w.merchantId === m.id).map((w) => webhookResponse(w))];
  }],
  ["POST", /^\/v1\/merchants\/webhooks$/, (b, h) => {
    const m = merchantFromJwt(h);
    if (!b?.targetUrl || !/^https?:\/\/.+/.test(b.targetUrl)) throw bad("VALIDATION_FAILED", "Webhook URL must be a valid http(s) URL");
    const w = { id: uuid(), merchantId: m.id, targetUrl: b.targetUrl, eventTypes: b.eventTypes || "ALL", enabled: true, webhookSecret: `whsec_${rand(28)}` };
    db.webhooks.push(w);
    return [201, webhookResponse(w, true)];
  }],
  ["GET", /^\/v1\/merchants\/webhooks\/([^/]+)$/, (b, h, [id]) => {
    const m = merchantFromJwt(h);
    const w = db.webhooks.find((x) => x.id === id && x.merchantId === m.id);
    if (!w) throw new HttpError(404, "RESOURCE_NOT_FOUND", "Webhook config not found");
    return [200, webhookResponse(w)];
  }],
  ["PUT", /^\/v1\/merchants\/webhooks\/([^/]+)$/, (b, h, [id]) => {
    const m = merchantFromJwt(h);
    const w = db.webhooks.find((x) => x.id === id && x.merchantId === m.id);
    if (!w) throw new HttpError(404, "RESOURCE_NOT_FOUND", "Webhook config not found");
    if (!b?.targetUrl || !/^https?:\/\/.+/.test(b.targetUrl)) throw bad("VALIDATION_FAILED", "Webhook URL must be a valid http(s) URL");
    Object.assign(w, { targetUrl: b.targetUrl, eventTypes: b.eventTypes || "ALL" });
    return [200, webhookResponse(w)];
  }],
  ["DELETE", /^\/v1\/merchants\/webhooks\/([^/]+)$/, (b, h, [id]) => {
    const m = merchantFromJwt(h);
    const i = db.webhooks.findIndex((x) => x.id === id && x.merchantId === m.id);
    if (i < 0) throw new HttpError(404, "RESOURCE_NOT_FOUND", "Webhook config not found");
    db.webhooks.splice(i, 1);
    return [204, null];
  }],

  ["POST", /^\/v1\/vault\/tokenize$/, (b, h) => {
    merchantFromApiKey(h);
    const pan = String(b?.pan || "").replace(/\s/g, "");
    if (!/^[0-9]{13,19}$/.test(pan)) throw bad("VALIDATION_FAILED", "PAN length is invalid");
    if (!luhn(pan)) throw bad("VALIDATION_FAILED", "Invalid card number");
    if (!/^[0-9]{3,4}$/.test(String(b.cvv || ""))) throw bad("VALIDATION_FAILED", "CVV length is invalid");
    const mm = +b.expiryMonth, yy = +b.expiryYear;
    if (!(mm >= 1 && mm <= 12)) throw bad("VALIDATION_FAILED", "Expiry must be between 1 to 12");
    const today = new Date();
    if (!yy || yy < today.getFullYear() || (yy === today.getFullYear() && mm < today.getMonth() + 1)) throw bad("VALIDATION_FAILED", "Card has expired");
    if (b.cardHolderName && b.cardHolderName.length < 3) throw bad("VALIDATION_FAILED", "Card Holder Name should have at least 3 characters");
    const card = { token: `tok_${rand(24)}`, lastFour: pan.slice(-4), brand: brandOf(pan), expiryMonth: mm, expiryYear: yy };
    db.cards.push(card); // only the token + last four are kept, never the PAN or CVV
    return [201, card];
  }],

  ["POST", /^\/v1\/orders$/, (b, h) => {
    const { merchant } = merchantFromApiKey(h);
    const units = b?.amount?.amountUnits;
    if (!Number.isInteger(units) || units < 100) throw bad("VALIDATION_FAILED", "Amount is required and must be at least 100 (₹1.00)");
    if (b.receipt && b.receipt.length > 100) throw bad("VALIDATION_FAILED", "Receipt must be at most 100 characters");
    let customerId = null;
    if (b.customer && (b.customer.email || b.customer.phone || b.customer.name)) {
      let c = db.customers.find((x) => x.merchantId === merchant.id && x.email && x.email === b.customer.email);
      if (!c) { c = { id: uuid(), merchantId: merchant.id, ...b.customer }; db.customers.push(c); }
      customerId = c.id;
    }
    const o = { id: uuid(), merchantId: merchant.id, customerId, receipt: b.receipt || null, amount: { amountUnits: units, currency: b.amount.currency || "INR" }, status: "CREATED", attempts: 0, notes: b.notes || {}, expiresAt: b.expiresAt || null, createdAt: now() };
    db.orders.push(o);
    return [201, orderResponse(o)];
  }],

  ["POST", /^\/v1\/payments$/, (b, h) => {
    const { merchant } = merchantFromApiKey(h);
    if (!b?.orderId) throw bad("VALIDATION_FAILED", "Order Id is required");
    if (!b.method) throw bad("VALIDATION_FAILED", "Payment method is required");
    const order = db.orders.find((o) => o.id === b.orderId && o.merchantId === merchant.id);
    if (!order) throw new HttpError(404, "RESOURCE_NOT_FOUND", "Order not found");
    if (order.status === "PAID") throw new HttpError(422, "BUSINESS_RULE_VIOLATION", "Order is already paid");
    if (!SIMULATOR[b.method]) throw bad("VALIDATION_FAILED", `Payment method ${b.method} is not supported`);
    const d = b.methodDetails || {};
    if (b.method === "CARD" && !db.cards.some((c) => c.token === d.token)) throw bad("VALIDATION_FAILED", "A valid card token from /v1/vault/tokenize is required");
    if (b.method === "UPI" && !/^[\w.-]+@[\w]+$/.test(d.vpa || "")) throw bad("VALIDATION_FAILED", "A valid UPI VPA is required (e.g. name@okbank)");
    if (b.method === "NETBANKING" && !d.bank) throw bad("VALIDATION_FAILED", "Bank code is required");
    order.status = "ATTEMPTED";
    order.attempts += 1;
    const cfg = SIMULATOR[b.method];
    const delay = (cfg.min + Math.random() * (cfg.max - cfg.min)) * 1000;
    const p = { id: uuid(), orderId: order.id, merchantId: merchant.id, amount: order.amount, status: "CREATED", method: b.method, methodDetails: d, createdAt: now(), transitions: [{ status: "CREATED", at: now() }] };
    db.payments.push(p);
    transition(p, "AUTHORIZING", { resolveAt: Date.now() + delay });
    history.upsert("orders", orderResponse(order));
    return [201, paymentResponse(p)];
  }],
  ["POST", /^\/v1\/payments\/([^/]+)\/capture$/, (b, h, [id]) => {
    const { merchant } = merchantFromApiKey(h);
    const p = db.payments.find((x) => x.id === id && x.merchantId === merchant.id);
    if (!p) throw new HttpError(404, "RESOURCE_NOT_FOUND", "Payment not found");
    if (p.status !== "AUTHORIZED") throw new HttpError(409, "INVALID_STATE_TRANSITION", `Cannot capture a payment in status ${p.status}`);
    transition(p, "CAPTURING", { resolveAt: Date.now() + 1200 });
    return [200, paymentResponse(p)];
  }],
];

export async function handle(method, path, body, headers) {
  if (!db) seed();
  await sleep(90 + Math.random() * 260);
  for (const [m, re, fn] of routes) {
    const match = m === method && path.match(re);
    if (!match) continue;
    try {
      const [status, data] = fn(body, headers, match.slice(1));
      save();
      return { status, data };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, data: { errorCode: e.errorCode, errorDescription: e.message } };
      throw e;
    }
  }
  return { status: 404, data: { errorCode: "NOT_FOUND", errorDescription: `No route for ${method} ${path}` } };
}

// ---------------- Demo seed data ----------------
export const DEMO_LOGIN = { email: "demo@paygate.dev", password: "demo12345" };

export function seed() {
  db = emptyDb();
  history.clear();
  const m = { id: uuid(), userId: uuid(), name: "Aarav Sharma", email: DEMO_LOGIN.email, password: DEMO_LOGIN.password, businessName: "Chai & Code Pvt Ltd", businessType: "PRIVATE_LIMITED", merchantStatus: "ACTIVE", createdAt: now() };
  db.merchants.push(m);
  const key = newApiKey(m.id, "TEST");
  key.lastUsedAt = now();
  db.apiKeys.push(key);
  keyring.save(key.keyId, key.secret);
  keyring.active = key.keyId;
  db.webhooks.push({ id: uuid(), merchantId: m.id, targetUrl: "https://chaiandcode.example/webhooks/payments", eventTypes: "ALL", enabled: true, webhookSecret: `whsec_${rand(28)}` });

  const names = ["Priya Patel", "Rohan Gupta", "Ananya Iyer", "Vikram Singh", "Neha Reddy", "Kabir Mehta", "Isha Nair", "Arjun Rao"];
  const methods = ["UPI", "UPI", "UPI", "CARD", "CARD", "NETBANKING"];
  const h = { orders: [], payments: [], webhooks: [] };
  for (let i = 0; i < 36; i++) {
    const created = new Date(Date.now() - Math.random() * 6.5 * 86400000 - 600000);
    const units = [19900, 49900, 99900, 149900, 29900, 249900, 9900][i % 7];
    const name = names[i % names.length];
    const order = { id: uuid(), merchantId: m.id, customerId: uuid(), receipt: `rcpt_${1001 + i}`, amount: { amountUnits: units, currency: "INR" }, status: "ATTEMPTED", attempts: 1, notes: { customer: name }, expiresAt: null, createdAt: created.toISOString() };
    const method = methods[i % methods.length];
    const roll = Math.random() * 100;
    const fail = roll > SIMULATOR[method].successRate;
    const t = (s) => new Date(created.getTime() + s * 1000).toISOString();
    const transitions = [{ status: "CREATED", at: t(1) }, { status: "AUTHORIZING", at: t(2) }];
    let status, extra = {};
    if (fail) {
      const [code, desc] = FAILURES[method][i % 2];
      status = "FAILED"; extra = { errorCode: code, errorDescription: desc };
      transitions.push({ status, at: t(6) });
    } else {
      transitions.push({ status: "AUTHORIZED", at: t(6) }, { status: "CAPTURING", at: t(40) }, { status: "CAPTURED", at: t(42) });
      status = "CAPTURED"; extra = { capturedAt: t(42) };
      order.status = "PAID";
    }
    const details = method === "UPI" ? { vpa: `${name.split(" ")[0].toLowerCase()}@okaxis` } : method === "CARD" ? { token: `tok_${rand(24)}`, last4: String(1000 + Math.floor(Math.random() * 8999)) } : { bank: ["HDFC", "ICIC", "SBIN", "UTIB"][i % 4] };
    const p = { id: uuid(), orderId: order.id, merchantId: m.id, amount: order.amount, status, method, methodDetails: details, createdAt: t(1), transitions, ...extra };
    db.orders.push(order);
    db.payments.push(p);
    h.orders.push(orderResponse(order));
    h.payments.push({ ...paymentResponse(p), transitions });
    h.webhooks.push({ id: uuid(), at: transitions.at(-1).at, eventType: "PAYMENT_STATUS_CHANGED", paymentId: p.id, status: Math.random() > 0.1 ? "DELIVERED" : "DLQ", targetUrl: db.webhooks[0].targetUrl, attempts: 1, payloadStatus: status, signature: `sha256=${rand(40).toLowerCase()}` });
  }
  const byDate = (a, b) => new Date(b.createdAt || b.at) - new Date(a.createdAt || a.at);
  h.orders.sort(byDate); h.payments.sort(byDate); h.webhooks.sort(byDate);
  history.save(h);
  save();
}

export function resetDemo() {
  seed();
}

export function ensureSeeded() {
  if (!db) seed();
}
