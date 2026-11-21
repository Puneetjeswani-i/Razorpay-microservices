import { api } from "../api.js";
import { history } from "../store.js";
import { badge, copy, esc, inr, modal, shortId, toast, when, withBusy } from "../ui.js";

const FILTERS = ["ALL", "CAPTURED", "AUTHORIZED", "AUTHORIZING", "FAILED"];

export function timeline(p) {
  const steps = p.transitions?.length ? p.transitions : [{ status: p.status, at: p.createdAt }];
  return `<div class="timeline">${steps.map((s) => `
    <div class="tl-item ${s.status === "FAILED" ? "bad" : ["CAPTURED", "AUTHORIZED", "SETTLED"].includes(s.status) ? "ok" : ""}">
      <div class="tl-dot"></div><div><b>${esc(s.status)}</b><div class="muted small">${when(s.at)}</div></div>
    </div>`).join("")}</div>`;
}

export async function capture(p) {
  try {
    const res = await api.capturePayment(p.id);
    history.upsert("payments", res);
    toast("Capture requested", "success");
    return res;
  } catch (err) {
    toast(err.message, "error");
  }
}

function openPayment(id) {
  const p = history.load().payments.find((x) => x.id === id);
  if (!p) return;
  const details = Object.entries(p.methodDetails || {}).map(([k, v]) => `<div class="row"><span class="muted">${esc(k)}</span><span class="spacer"></span><code>${esc(v)}</code></div>`).join("");
  modal({
    title: `Payment ${shortId(p.id)}`,
    body: `
      <div class="stack">
        <div class="row"><div><div class="muted small">Amount</div><h1>${inr(p.amount)}</h1></div><span class="spacer"></span>${badge(p.status)}</div>
        ${p.errorCode ? `<div class="notice warn"><span>⚠️</span><span><b>${esc(p.errorCode)}</b> — ${esc(p.errorDescription)}</span></div>` : ""}
        <div class="grid cols-2">
          <div class="stack" style="gap:6px"><h3>Details</h3>
            <div class="row"><span class="muted">Method</span><span class="spacer"></span><b>${esc(p.method)}</b></div>
            ${details}
            <div class="row"><span class="muted">Order</span><span class="spacer"></span><code>${esc(shortId(p.orderId))}</code></div>
            <div class="row"><span class="muted">Captured</span><span class="spacer"></span><span>${when(p.capturedAt)}</span></div>
            <button class="btn sm" id="copy-id">Copy payment ID</button>
          </div>
          <div class="stack" style="gap:6px"><h3>State machine</h3>${timeline(p)}</div>
        </div>
        ${p.status === "AUTHORIZED" ? `<button class="btn primary" id="capture">Capture ${inr(p.amount)}</button>` : ""}
      </div>`,
    onMount(el, close) {
      el.querySelector("#copy-id").addEventListener("click", () => copy(p.id));
      el.querySelector("#capture")?.addEventListener("click", (e) => withBusy(e.currentTarget, async () => { await capture(p); close(); }));
    },
  });
}

export function renderPayments(root) {
  let filter = "ALL";
  const draw = () => {
    const pays = history.load().payments.filter((p) => filter === "ALL" || p.status === filter);
    root.innerHTML = `
      <div class="page-head"><div><h1>Payments</h1><p class="desc">Every payment moves through the payment-service state machine: CREATED → AUTHORIZING → AUTHORIZED → CAPTURING → CAPTURED.</p></div>
        <span class="spacer"></span><a class="btn primary" href="#/checkout">+ New test payment</a></div>
      <div class="row wrap">${FILTERS.map((f) => `<button class="btn sm ${f === filter ? "primary" : ""}" data-filter="${f}">${f === "ALL" ? "All" : f}</button>`).join("")}</div>
      <div class="card"><div class="table-wrap">${pays.length ? `
        <table><thead><tr><th>Payment ID</th><th>Amount</th><th>Method</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
        ${pays.map((p) => `<tr class="clickable" data-id="${p.id}"><td class="mono">${esc(shortId(p.id))}</td><td><b>${inr(p.amount)}</b></td><td>${esc(p.method)}</td>
          <td>${badge(p.status)}${p.errorCode ? ` <span class="muted small">${esc(p.errorCode)}</span>` : ""}</td><td class="muted">${when(p.createdAt)}</td>
          <td>${p.status === "AUTHORIZED" ? `<button class="btn sm" data-capture="${p.id}">Capture</button>` : ""}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">No payments match this filter.</div>`}</div></div>`;
    root.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; draw(); }));
    root.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
      const cap = e.target.closest("[data-capture]");
      if (cap) {
        e.stopPropagation();
        const p = history.load().payments.find((x) => x.id === cap.dataset.capture);
        withBusy(cap, () => capture(p));
        return;
      }
      openPayment(tr.dataset.id);
    }));
  };
  draw();
  window.addEventListener("history-changed", draw);
  return () => window.removeEventListener("history-changed", draw);
}
