import { api } from "../api.js";
import { keyring } from "../store.js";
import { badge, copy, esc, modal, toast, when, withBusy } from "../ui.js";

function showSecret(created, title) {
  keyring.save(created.keyId, created.keySecret);
  keyring.active = created.keyId;
  modal({
    title,
    body: `
      <div class="stack">
        <div class="notice warn"><span>🔑</span><span>The key secret is shown <b>only once</b>. It is saved in this browser so the dashboard can call the payments API with it.</span></div>
        <label class="field">Key ID<div class="secret-box"><code>${esc(created.keyId)}</code><button class="btn sm" data-copy="${esc(created.keyId)}">Copy</button></div></label>
        <label class="field">Key secret<div class="secret-box"><code>${esc(created.keySecret)}</code><button class="btn sm" data-copy="${esc(created.keySecret)}">Copy</button></div></label>
        <p class="muted small">Use it as HTTP Basic auth: <code>Authorization: Basic base64(keyId:keySecret)</code>. The API gateway validates it, applies rate limiting, and forwards <code>X-Merchant-Id</code> to the services.</p>
        <button class="btn primary" data-close>Done</button>
      </div>`,
    onMount(el) { el.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy))); },
  });
}

export async function renderApiKeys(root) {
  root.innerHTML = `
    <div class="page-head"><div><h1>API keys</h1><p class="desc">Keys authenticate server-to-server calls (orders, payments, vault). Managed by <b>merchant-service</b>, cached in Redis by the gateway.</p></div>
      <span class="spacer"></span>
      <select id="env" style="width:auto"><option>TEST</option><option>LIVE</option></select>
      <button class="btn primary" id="create">Generate key</button></div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`;

  const load = async () => {
    const list = root.querySelector("#list");
    try {
      const keys = await api.listApiKeys();
      const active = keyring.active;
      list.innerHTML = keys.length ? `<div class="table-wrap"><table><thead><tr><th>Key ID</th><th>Mode</th><th>Status</th><th>Last used</th><th>Created</th><th>Used by dashboard</th><th></th></tr></thead><tbody>
        ${keys.map((k) => `<tr><td class="mono">${esc(k.keyId)}</td><td>${badge(k.environment)}</td><td>${badge(k.enabled ? "ACTIVE" : "SUSPENDED")}</td>
          <td class="muted">${when(k.lastUsedAt)}</td><td class="muted">${when(k.createdAt)}</td>
          <td>${k.enabled && keyring.secret(k.keyId) ? (k.keyId === active ? `<span class="badge success">In use</span>` : `<button class="btn sm" data-use="${esc(k.keyId)}">Use</button>`) : `<span class="muted small">${k.enabled ? "secret not in this browser" : "—"}</span>`}</td>
          <td>${k.enabled ? `<button class="btn sm" data-rotate="${esc(k.keyId)}">Rotate</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No API keys yet. Generate one to start accepting payments.</div>`;
      list.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => { keyring.active = b.dataset.use; toast("Dashboard will use this key"); load(); }));
      list.querySelectorAll("[data-rotate]").forEach((b) => b.addEventListener("click", () => withBusy(b, async () => {
        try { showSecret(await api.rotateApiKey(b.dataset.rotate), "Key rotated"); await load(); }
        catch (err) { toast(err.message, "error"); }
      })));
    } catch (err) {
      list.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  };

  root.querySelector("#create").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    try { showSecret(await api.createApiKey(root.querySelector("#env").value), "API key created"); await load(); }
    catch (err) { toast(err.message, "error"); }
  }));
  await load();
}
