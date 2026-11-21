// Small localStorage-backed store for settings, session and local history.
// The backend has no "list orders / list payments" endpoints, so the dashboard
// keeps a history of the orders and payments it created, per mode.

const PREFIX = "paygate.";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) - keep working in memory */
  }
}

const memory = {};

export const settings = {
  get mode() { return read("mode", "demo"); },
  set mode(v) { write("mode", v); },
  get baseUrl() { return read("baseUrl", "http://localhost:8080"); },
  set baseUrl(v) { write("baseUrl", v); },
};

function scoped(key) {
  return `${settings.mode}.${key}`;
}

export const session = {
  get() { return read(scoped("session"), null) ?? memory[scoped("session")] ?? null; },
  set(value) { memory[scoped("session")] = value; write(scoped("session"), value); },
  clear() { delete memory[scoped("session")]; try { localStorage.removeItem(PREFIX + scoped("session")); } catch {} },
};

// The API key secret is only returned once, at creation. We keep it locally so
// the dashboard can call API-key-authenticated endpoints (orders, payments, vault).
export const keyring = {
  all() { return read(scoped("keys"), {}); },
  save(keyId, keySecret) { const k = this.all(); k[keyId] = keySecret; write(scoped("keys"), k); },
  secret(keyId) { return this.all()[keyId]; },
  get active() { return read(scoped("activeKey"), null); },
  set active(keyId) { write(scoped("activeKey"), keyId); },
};

export const history = {
  load() { return read(scoped("history"), { orders: [], payments: [], webhooks: [] }); },
  save(h) { write(scoped("history"), h); },
  upsert(kind, item) {
    const h = this.load();
    const list = h[kind] || (h[kind] = []);
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = { ...list[i], ...item };
    else list.unshift(item);
    this.save(h);
    window.dispatchEvent(new CustomEvent("history-changed"));
  },
  clear() { write(scoped("history"), { orders: [], payments: [], webhooks: [] }); },
};

export const requestLog = {
  entries: [],
  push(entry) {
    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, 60);
    window.dispatchEvent(new CustomEvent("request-logged", { detail: entry }));
  },
};
