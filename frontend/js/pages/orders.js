import { api } from "../api.js";
import { history } from "../store.js";
import { badge, esc, formData, inr, modal, shortId, toast, when, withBusy } from "../ui.js";
import { navigate } from "../app.js";

export function openCreateOrder(onCreated) {
  modal({
    title: "Create order",
    body: `
      <form class="form-grid" id="order-form">
        <label class="field">Amount (₹)<input name="amount" type="number" min="1" step="0.01" value="499" required></label>
        <label class="field">Receipt<input name="receipt" maxlength="100" value="rcpt_${Date.now().toString().slice(-6)}"></label>
        <label class="field">Customer name<input name="name" maxlength="200" placeholder="Priya Patel"></label>
        <label class="field">Customer email<input name="email" type="email" maxlength="200" placeholder="priya@example.com"></label>
        <label class="field full">Customer phone<input name="phone" maxlength="20" placeholder="+91 98765 43210"></label>
        <p class="muted small full"><code>POST /v1/orders</code> · authenticated with your API key · sent with an <code>X-Idempotency-Key</code></p>
        <button class="btn primary full" type="submit">Create order</button>
      </form>`,
    onMount(el, close) {
      el.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const customer = f.name || f.email || f.phone ? { name: f.name || null, email: f.email || null, phone: f.phone || null } : null;
        withBusy(e.submitter, async () => {
          try {
            const order = await api.createOrder({
              amount: { amountUnits: Math.round(parseFloat(f.amount) * 100), currency: "INR" },
              receipt: f.receipt || null,
              notes: customer?.name ? { customer: customer.name } : {},
              customer,
            });
            history.upsert("orders", order);
            toast("Order created", "success");
            close();
            onCreated?.(order);
          } catch (err) {
            toast(err.message, "error");
            if (err.errorCode === "NO_API_KEY") { close(); navigate("/api-keys"); }
          }
        });
      });
    },
  });
}

export function renderOrders(root) {
  const draw = () => {
    const { orders } = history.load();
    root.innerHTML = `
      <div class="page-head"><div><h1>Orders</h1><p class="desc">An order is created by the merchant's server before checkout. Payments are attempts against an order.</p></div>
        <span class="spacer"></span><button class="btn primary" id="new-order">+ Create order</button></div>
      <div class="card"><div class="table-wrap">${orders.length ? `
        <table><thead><tr><th>Order ID</th><th>Receipt</th><th>Amount</th><th>Attempts</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
        ${orders.map((o) => `<tr><td class="mono" title="${esc(o.id)}">${esc(shortId(o.id))}</td><td>${esc(o.receipt || "—")}</td><td><b>${inr(o.amount)}</b></td>
          <td>${o.attempts ?? 0}</td><td>${badge(o.status)}</td><td class="muted">${when(o.createdAt)}</td>
          <td>${o.status !== "PAID" ? `<a class="btn sm" href="#/checkout?order=${o.id}">Pay</a>` : ""}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">No orders yet.</div>`}</div></div>`;
    root.querySelector("#new-order").addEventListener("click", () => openCreateOrder((o) => navigate(`/checkout?order=${o.id}`)));
  };
  draw();
  window.addEventListener("history-changed", draw);
  return () => window.removeEventListener("history-changed", draw);
}
