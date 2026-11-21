import { requestLog, session, settings, isLocalHost, isPublicHttpsUrl } from "../store.js";
import { resetDemo } from "../mock.js";
import { esc, toast, when } from "../ui.js";
import { switchMode } from "../app.js";

export function renderSettings(root) {
  const draw = () => {
    root.innerHTML = `
      <div class="page-head"><div><h1>Settings & logs</h1><p class="desc">Choose where API calls go, and inspect every request this dashboard has made.</p></div></div>
      <div class="grid cols-2">
        <div class="card card-body stack">
          <h3>Backend mode</h3>
          <label class="row"><input type="radio" name="mode" value="demo" style="width:auto" ${settings.mode === "demo" ? "checked" : ""}> <span><b>Demo</b> — simulated backend in your browser, same API contracts</span></label>
          <label class="row"><input type="radio" name="mode" value="live" style="width:auto" ${settings.mode === "live" ? "checked" : ""}> <span><b>Live</b> — call a running API gateway</span></label>
          <form class="stack" id="live-form" style="gap:10px">
            <label class="field">API gateway URL<input name="baseUrl" value="${esc(settings.baseUrl)}" placeholder="http://localhost:8080"></label>
            <button class="btn" type="submit">Save URL</button>
          </form>
          <div class="notice warn"><span>ℹ️</span><span>Live mode calls the gateway straight from the browser, so the gateway must allow this site (CORS). ${isLocalHost
            ? "Running locally, <code>http://localhost:8080</code> works if you start <code>tools/live-proxy</code> in front of the gateway."
            : "On this hosted site the URL must be a public <b>https://</b> address, e.g. a Cloudflare tunnel to <code>tools/live-proxy</code>."}
            <a href="https://github.com/Puneetjeswani-i/Razorpay-microservices/tree/main/tools/live-proxy#readme" target="_blank" rel="noopener">Setup guide →</a></span></div>
        </div>
        <div class="card card-body stack">
          <h3>Demo data</h3>
          <p class="muted">Demo data lives only in this browser. Reset it to get back the sample merchant, API key, webhook and a week of payments.</p>
          <div><button class="btn danger" id="reset">Reset demo data</button></div>
          <p class="muted small">Demo login: <code>demo@paygate.dev</code> / <code>demo12345</code></p>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Request log</h3><span class="spacer"></span><span class="muted small">this session · ${requestLog.entries.length} requests</span></div>
        ${requestLog.entries.length ? requestLog.entries.map((e) => `<div class="log-row"><span class="method ${e.method}">${e.method}</span><span><code>${esc(e.path)}</code> <span class="muted small">· ${esc(e.service)} · ${esc(e.mode)}</span></span><span class="muted small">${when(e.at)}</span><span class="badge ${e.status && e.status < 400 ? "success" : "danger"}">${e.status || "ERR"} · ${e.ms}ms</span></div>`).join("") : `<div class="empty">No requests yet.</div>`}
      </div>`;
    root.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => switchMode(r.value)));
    root.querySelector("#live-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const url = (new FormData(e.target).get("baseUrl").trim() || "http://localhost:8080").replace(/\/+$/, "");
      if (!isLocalHost && !isPublicHttpsUrl(url)) {
        return toast("On the hosted site the gateway URL must be a public https:// address (not localhost or http://).", "error");
      }
      settings.baseUrl = url;
      toast("Gateway URL saved", "success");
    });
    root.querySelector("#reset").addEventListener("click", () => {
      if (settings.mode !== "demo") return toast("Switch to Demo mode first", "error");
      resetDemo();
      session.clear();
      toast("Demo data reset", "success");
      location.hash = "/login";
    });
  };
  draw();
  window.addEventListener("request-logged", draw);
  return () => window.removeEventListener("request-logged", draw);
}
