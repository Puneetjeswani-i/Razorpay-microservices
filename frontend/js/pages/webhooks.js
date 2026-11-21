import { api } from "../api.js";
import { history, settings } from "../store.js";
import { badge, copy, esc, formData, modal, shortId, toast, when, withBusy } from "../ui.js";

function editor(existing, onSaved) {
  modal({
    title: existing ? "Edit webhook" : "Add webhook",
    body: `
      <form class="stack" id="wh-form">
        <label class="field">Endpoint URL<input name="targetUrl" type="url" required maxlength="500" value="${esc(existing?.targetUrl || "https://")}"></label>
        <label class="field">Event types<input name="eventTypes" maxlength="1000" value="${esc(existing?.eventTypes || "ALL")}"><span class="hint">Comma-separated, e.g. <code>PAYMENT_STATUS_CHANGED,REFUND_CREATED</code>, or <code>ALL</code></span></label>
        <button class="btn primary" type="submit">${existing ? "Save changes" : "Add webhook"}</button>
      </form>`,
    onMount(el, close) {
      el.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        const body = formData(e.target);
        withBusy(e.submitter, async () => {
          try {
            const saved = existing ? await api.updateWebhook(existing.id, body) : await api.createWebhook(body);
            close();
            if (saved?.webhookSecret) {
              modal({
                title: "Webhook signing secret",
                body: `<div class="stack"><p>Verify each delivery's signature with this secret. It is shown only once.</p>
                  <div class="secret-box"><code>${esc(saved.webhookSecret)}</code><button class="btn sm" id="cp">Copy</button></div>
                  <button class="btn primary" data-close>Done</button></div>`,
                onMount(m) { m.querySelector("#cp").addEventListener("click", () => copy(saved.webhookSecret)); },
              });
            } else toast("Webhook saved", "success");
            onSaved();
          } catch (err) { toast(err.message, "error"); }
        });
      });
    },
  });
}

export async function renderWebhooks(root) {
  root.innerHTML = `
    <div class="page-head"><div><h1>Webhooks</h1><p class="desc">operations-service consumes payment events from Kafka and delivers them to these endpoints, with a Redis retry queue and a dead letter queue.</p></div>
      <span class="spacer"></span><button class="btn primary" id="add">+ Add webhook</button></div>
    <div class="card" id="configs"><div class="empty">Loading…</div></div>
    <div class="card"><div class="card-head"><h3>Recent deliveries</h3><span class="spacer"></span><span class="muted small">${settings.mode === "demo" ? "simulated" : "recorded by this dashboard"}</span></div><div id="deliveries"></div></div>`;

  const drawDeliveries = () => {
    const list = history.load().webhooks || [];
    root.querySelector("#deliveries").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Payment</th><th>Payload status</th><th>Delivery</th><th>Signature</th><th>Time</th></tr></thead><tbody>
      ${list.slice(0, 25).map((d) => `<tr><td><code>${esc(d.eventType)}</code></td><td class="mono">${esc(shortId(d.paymentId))}</td><td>${badge(d.payloadStatus)}</td><td>${badge(d.status)}</td><td class="mono muted">${esc(String(d.signature).slice(0, 18))}…</td><td class="muted">${when(d.at)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">${settings.mode === "demo" ? "No deliveries yet. Make a payment to trigger one." : "Delivery history lives in operations-service and is not exposed through the public API."}</div>`;
  };

  const load = async () => {
    const box = root.querySelector("#configs");
    try {
      const configs = await api.listWebhooks();
      box.innerHTML = configs.length ? `<div class="table-wrap"><table><thead><tr><th>Endpoint</th><th>Events</th><th>Status</th><th></th></tr></thead><tbody>
        ${configs.map((w) => `<tr><td><code>${esc(w.targetUrl)}</code></td><td>${esc(w.eventTypes || "ALL")}</td><td>${badge(w.enabled ? "ACTIVE" : "SUSPENDED")}</td>
          <td class="row" style="justify-content:flex-end"><button class="btn sm" data-edit="${w.id}">Edit</button><button class="btn sm danger" data-del="${w.id}">Delete</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No webhook endpoints configured.</div>`;
      box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editor(configs.find((c) => c.id === b.dataset.edit), load)));
      box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => withBusy(b, async () => {
        try { await api.deleteWebhook(b.dataset.del); toast("Webhook deleted"); await load(); } catch (err) { toast(err.message, "error"); }
      })));
    } catch (err) {
      box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  };

  root.querySelector("#add").addEventListener("click", () => editor(null, load));
  drawDeliveries();
  window.addEventListener("history-changed", drawDeliveries);
  await load();
  return () => window.removeEventListener("history-changed", drawDeliveries);
}
