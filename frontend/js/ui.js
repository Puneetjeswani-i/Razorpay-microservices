// Tiny UI helpers: html escaping, formatting, toasts, modals, icons.

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function inr(money) {
  if (!money) return "—";
  const units = typeof money === "number" ? money : money.amountUnits;
  const cur = money.currency || "INR";
  const value = (units / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === "INR" ? `₹${value}` : `${value} ${cur}`;
}

export function when(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function shortId(id) {
  return id ? `${String(id).slice(0, 8)}…` : "—";
}

const STATUS_TONE = {
  CAPTURED: "success", SETTLED: "success", PAID: "success", AUTHORIZED: "info", ACTIVE: "success",
  CREATED: "brand", ATTEMPTED: "warning", AUTHORIZING: "warning", CAPTURING: "warning", PENDING_KYC: "warning",
  FAILED: "danger", CANCELLED: "danger", AUTH_EXPIRED: "danger", SUSPENDED: "danger",
  REFUNDED: "info", PARTIALLY_REFUNDED: "info", DELIVERED: "success", RETRYING: "warning", DLQ: "danger",
};

export function badge(status) {
  return `<span class="badge ${STATUS_TONE[status] || ""}">${esc(status)}</span>`;
}

export function toast(message, type = "") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function modal({ title, body, onMount }) {
  const root = document.getElementById("modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="card modal" role="dialog" aria-label="${esc(title)}">
      <div class="card-head"><h2>${esc(title)}</h2><button class="btn ghost sm" data-close aria-label="Close">✕</button></div>
      <div class="card-body">${body}</div>
    </div>`;
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
  root.appendChild(wrap);
  onMount?.(wrap.querySelector(".modal"), close);
  return close;
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  catch { toast("Copy failed — select and copy manually", "error"); }
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export async function withBusy(button, fn) {
  const label = button.innerHTML;
  button.disabled = true;
  button.innerHTML = "Working…";
  try { return await fn(); }
  finally { button.disabled = false; button.innerHTML = label; }
}

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  orders: '<path d="M6 3h12l1 18H5zM9 7a3 3 0 006 0"/>',
  payments: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  checkout: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3"/>',
  webhook: '<path d="M8 17a4 4 0 11-4-4M12 4a4 4 0 014 4l-4 7M16 20a4 4 0 110-8"/>',
  arch: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="8.5" y="14" width="7" height="7" rx="1"/><path d="M6.5 10v2h11v-2M12 12v2"/>',
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  logout: '<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}
