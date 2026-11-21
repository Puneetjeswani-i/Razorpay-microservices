import { api } from "../api.js";
import { history, settings } from "../store.js";
import { badge, esc, formData, inr, shortId, toast, withBusy } from "../ui.js";
import { navigate } from "../app.js";
import { openCreateOrder } from "./orders.js";
import { capture, timeline } from "./payments.js";

const BANKS = [["HDFC", "HDFC Bank"], ["ICIC", "ICICI Bank"], ["SBIN", "State Bank of India"], ["UTIB", "Axis Bank"], ["KKBK", "Kotak Mahindra Bank"]];

const METHOD_FORMS = {
  CARD: () => `
    <label class="field">Card number<input name="pan" inputmode="numeric" value="4111 1111 1111 1111" required></label>
    <div class="form-grid">
      <label class="field">Expiry month<input name="expiryMonth" type="number" min="1" max="12" value="12" required></label>
      <label class="field">Expiry year<input name="expiryYear" type="number" value="${new Date().getFullYear() + 3}" required></label>
      <label class="field">CVV<input name="cvv" inputmode="numeric" maxlength="4" value="123" required></label>
      <label class="field">Name on card<input name="cardHolderName" value="Priya Patel"></label>
    </div>
    <p class="muted small">Test card prefilled. The card is first tokenized by <b>vault-service</b> (<code>POST /v1/vault/tokenize</code>); only the token is sent with the payment.</p>`,
  UPI: () => `
    <label class="field">UPI ID<input name="vpa" value="priya@okaxis" required><span class="hint">Sent as <code>methodDetails.vpa</code></span></label>`,
  NETBANKING: () => `
    <label class="field">Bank<select name="bank">${BANKS.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select><span class="hint">Sent as <code>methodDetails.bank</code></span></label>`,
};

export function renderCheckout(root) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  let orderId = params.get("order");
  let method = "UPI";
  let paymentId = null;
  const exchanges = [];

  const unpaid = () => history.load().orders.filter((o) => o.status !== "PAID");

  const draw = () => {
    const orders = unpaid();
    if (!orderId && orders.length) orderId = orders[0].id;
    const order = history.load().orders.find((o) => o.id === orderId);
    const payment = paymentId && history.load().payments.find((p) => p.id === paymentId);

    root.innerHTML = `
      <div class="page-head"><div><h1>Test checkout</h1><p class="desc">Pay an order the way a customer would, and see each API call it makes.</p></div></div>
      <div class="grid checkout-layout">
        <div class="card checkout">
          <div class="checkout-summary">
            <div class="small" style="opacity:.8">Paying</div>
            <div class="amount">${order ? inr(order.amount) : "—"}</div>
            <div class="small" style="opacity:.85">${order ? `Order <span class="mono">${esc(shortId(order.id))}</span><br>${esc(order.receipt || "")}` : "No unpaid order"}</div>
            <label class="field" style="color:#fff">Order
              <select id="order-select">${orders.map((o) => `<option value="${o.id}" ${o.id === orderId ? "selected" : ""}>${esc(o.receipt || shortId(o.id))} · ${inr(o.amount)}</option>`).join("") || "<option>No unpaid orders</option>"}</select>
            </label>
            <button class="btn sm" id="new-order" style="align-self:flex-start">+ New order</button>
            <div class="spacer"></div>
            <div class="small" style="opacity:.75">${settings.mode === "demo" ? "Demo mode: the bank callback is simulated with the same per-method delay and success rate as payment-service." : "Live mode: calls go to your API gateway."}</div>
          </div>
          <div class="checkout-body">
            ${payment ? `
              <div class="stack">
                <div class="row"><h2>Payment ${esc(shortId(payment.id))}</h2><span class="spacer"></span>${badge(payment.status)}</div>
                ${payment.status === "AUTHORIZING" ? `<div class="notice"><span>⏳</span><span>Waiting for the bank callback… ${esc(payment.method)} usually takes a few seconds.</span></div>` : ""}
                ${payment.errorCode ? `<div class="notice warn"><span>⚠️</span><span><b>${esc(payment.errorCode)}</b> — ${esc(payment.errorDescription)}</span></div>` : ""}
                ${payment.status === "CAPTURED" ? `<div class="notice" style="background:var(--success-soft);color:#0b6b36"><span>✅</span><span>Payment captured. The order is now <b>PAID</b> and a webhook was queued.</span></div>` : ""}
                ${timeline(payment)}
                <div class="row wrap">
                  ${payment.status === "AUTHORIZED" ? `<button class="btn primary" id="capture">Capture ${inr(payment.amount)}</button>` : ""}
                  ${["FAILED", "CAPTURED"].includes(payment.status) ? `<button class="btn" id="again">${payment.status === "FAILED" ? "Try again" : "New payment"}</button>` : ""}
                </div>
              </div>` : `
              <div class="method-tabs">${Object.keys(METHOD_FORMS).map((m) => `<button class="method-tab ${m === method ? "on" : ""}" data-method="${m}">${m === "NETBANKING" ? "Net banking" : m === "UPI" ? "UPI" : "Card"}</button>`).join("")}</div>
              <form class="stack" id="pay-form" style="gap:14px">${METHOD_FORMS[method]()}
                <button class="btn primary block" type="submit" ${order ? "" : "disabled"}>Pay ${order ? inr(order.amount) : ""}</button>
              </form>`}
          </div>
        </div>
        <div class="card"><div class="card-head"><h3>API calls</h3><span class="spacer"></span><span class="muted small">newest first</span></div>
          <div class="card-body stack">${exchanges.length ? exchanges.map((x) => `
            <div class="stack" style="gap:6px"><div class="row"><span class="method ${x.method}">${x.method}</span><code>${esc(x.path)}</code><span class="spacer"></span><span class="badge ${x.ok ? "success" : "danger"}">${x.ok ? "OK" : "ERROR"}</span></div>
            <div class="codebox">${esc(JSON.stringify(x.payload, null, 2))}</div></div>`).join("") : `<p class="muted">Calls made during checkout appear here with their request and response bodies.</p>`}</div></div>
      </div>`;

    root.querySelector("#order-select")?.addEventListener("change", (e) => { orderId = e.target.value; paymentId = null; draw(); });
    root.querySelector("#new-order").addEventListener("click", () => openCreateOrder((o) => { orderId = o.id; paymentId = null; draw(); }));
    root.querySelectorAll("[data-method]").forEach((b) => b.addEventListener("click", () => { method = b.dataset.method; draw(); }));
    root.querySelector("#capture")?.addEventListener("click", (e) => withBusy(e.currentTarget, () => track("POST", `/v1/payments/${payment.id}/capture`, null, () => capture(payment))));
    root.querySelector("#again")?.addEventListener("click", () => { paymentId = null; if (payment.status === "CAPTURED") orderId = null; draw(); });
    root.querySelector("#pay-form")?.addEventListener("submit", (e) => { e.preventDefault(); withBusy(e.submitter, () => pay(order, formData(e.target))); });
  };

  async function track(method, path, req, fn) {
    try {
      const res = await fn();
      exchanges.unshift({ method, path, ok: true, payload: { request: req ?? undefined, response: res ?? "(see payment status)" } });
      return res;
    } catch (err) {
      exchanges.unshift({ method, path, ok: false, payload: { request: req ?? undefined, error: { status: err.status, errorCode: err.errorCode, message: err.message } } });
      throw err;
    }
  }

  async function pay(order, f) {
    try {
      let methodDetails;
      if (method === "CARD") {
        const req = { pan: f.pan.replace(/\s/g, ""), cvv: f.cvv, expiryMonth: +f.expiryMonth, expiryYear: +f.expiryYear, cardHolderName: f.cardHolderName || null, customerId: order.customerId || null };
        const masked = { ...req, pan: `${req.pan.slice(0, 6)}******${req.pan.slice(-4)}`, cvv: "***" };
        const card = await track("POST", "/v1/vault/tokenize", masked, () => api.tokenizeCard(req));
        methodDetails = { token: card.token };
      } else if (method === "UPI") {
        methodDetails = { vpa: f.vpa };
      } else {
        methodDetails = { bank: f.bank };
      }
      const body = { orderId: order.id, method, methodDetails };
      const payment = await track("POST", "/v1/payments", body, () => api.initPayment(body));
      history.upsert("payments", { ...payment, transitions: payment.transitions || [{ status: payment.status, at: payment.createdAt }] });
      paymentId = payment.id;
      draw();
    } catch (err) {
      toast(err.message, "error");
      if (err.errorCode === "NO_API_KEY") navigate("/api-keys");
      draw();
    }
  }

  draw();
  const onChange = () => { if (!document.querySelector(".modal") && !root.querySelector("#pay-form:focus-within")) draw(); };
  window.addEventListener("history-changed", onChange);
  return () => window.removeEventListener("history-changed", onChange);
}
