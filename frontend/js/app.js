import { settings, session, isLocalHost, isPublicHttpsUrl, liveModeUsable } from "./store.js";
import { ensureSeeded, resetDemo, DEMO_LOGIN } from "./mock.js";
import { api } from "./api.js";
import { esc, icon, modal } from "./ui.js";
import { renderLogin, renderSignup } from "./pages/auth.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderOrders } from "./pages/orders.js";
import { renderPayments } from "./pages/payments.js";
import { renderCheckout } from "./pages/checkout.js";
import { renderApiKeys } from "./pages/apikeys.js";
import { renderWebhooks } from "./pages/webhooks.js";
import { renderArchitecture } from "./pages/architecture.js";
import { renderSettings } from "./pages/settings.js";

const NAV = [
  { section: "Overview" },
  { path: "/dashboard", label: "Dashboard", icon: "home", render: renderDashboard },
  { path: "/orders", label: "Orders", icon: "orders", render: renderOrders },
  { path: "/payments", label: "Payments", icon: "payments", render: renderPayments },
  { path: "/checkout", label: "Test checkout", icon: "checkout", render: renderCheckout },
  { section: "Developers" },
  { path: "/api-keys", label: "API keys", icon: "key", render: renderApiKeys },
  { path: "/webhooks", label: "Webhooks", icon: "webhook", render: renderWebhooks },
  { path: "/architecture", label: "Architecture", icon: "arch", render: renderArchitecture },
  { path: "/settings", label: "Settings & logs", icon: "settings", render: renderSettings },
];

const app = document.getElementById("app");
let cleanup = null;

export function navigate(path) {
  if (location.hash !== `#${path}`) location.hash = path;
  else route();
}

function currentPath() {
  return location.hash.replace(/^#/, "").split("?")[0] || "/dashboard";
}

function layout(active, title) {
  const s = session.get();
  const mode = settings.mode;
  return `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-logo"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M10 24V8h8a5 5 0 010 10h-8" stroke="white" stroke-width="3.4" fill="none"/></svg></div>PayGate</div>
      ${NAV.map((n) => n.section
        ? `<div class="nav-section">${n.section}</div>`
        : `<a class="nav-link ${n.path === active ? "active" : ""}" href="#${n.path}">${icon(n.icon)}${n.label}</a>`).join("")}
      <div class="sidebar-foot">
        Signed in as<br><b style="color:#fff">${esc(s?.email || "merchant")}</b>
        <div style="margin-top:10px"><a href="#/logout" class="nav-link" style="padding:6px 0">${icon("logout")}Log out</a></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn ghost sm menu-btn" id="menu-btn" aria-label="Open menu">${icon("menu")}</button>
        <h3>${esc(title)}</h3>
        <div class="spacer"></div>
        <div class="mode-pill" role="group" aria-label="Backend mode">
          <button data-mode="demo" class="${mode === "demo" ? "on" : ""}" title="Simulated backend running in your browser">Demo</button>
          <button data-mode="live" class="${mode === "live" ? "on" : ""}" title="Call a real API gateway">Live</button>
        </div>
      </header>
      <main class="content" id="page"></main>
    </div>
  </div>`;
}

function wireLayout() {
  const sidebar = document.getElementById("sidebar");
  document.getElementById("menu-btn")?.addEventListener("click", (e) => { e.stopPropagation(); sidebar.classList.toggle("open"); });
  document.querySelector(".main")?.addEventListener("click", () => sidebar.classList.remove("open"));
  sidebar.querySelectorAll(".nav-link").forEach((a) => a.addEventListener("click", () => sidebar.classList.remove("open")));
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
}

function applyMode(mode) {
  settings.mode = mode;
  if (mode === "demo") ensureSeeded();
  if (!session.get() && !["/login", "/signup"].includes(currentPath())) return navigate("/login");
  route();
}

const SETUP_GUIDE = "https://github.com/Puneetjeswani-i/Razorpay-microservices/tree/main/tools/live-proxy#readme";

// On the public site, Live mode needs a public HTTPS gateway URL (for example a Cloudflare tunnel
// to tools/live-proxy). Ask for it before switching, so visitors never land in a mode that can't connect.
function connectLiveDialog() {
  route(); // keep the toggles showing the current mode until the visitor connects
  const current = isPublicHttpsUrl(settings.baseUrl) ? settings.baseUrl : "";
  modal({
    title: "Connect to your backend",
    body: `
      <form class="stack" id="live-connect">
        <p>Live mode sends every request to your real API gateway instead of the built-in demo. On this hosted site the gateway needs a <b>public HTTPS URL</b>; <code>localhost</code> can't be reached from a website.</p>
        <label class="field">Gateway URL<input name="url" type="url" required placeholder="https://your-tunnel.trycloudflare.com" value="${esc(current)}"></label>
        <p class="small" id="live-error" style="color:var(--danger)"></p>
        <p class="muted small">Start the backend, then <code>tools/live-proxy</code> (adds CORS) and a Cloudflare tunnel. <a href="${SETUP_GUIDE}" target="_blank" rel="noopener">Setup guide →</a></p>
        <div class="row wrap"><button class="btn" type="button" data-close>Stay in Demo</button><span class="spacer"></span><button class="btn primary" type="submit">Connect</button></div>
      </form>`,
    onMount(el, close) {
      el.querySelector("#live-connect").addEventListener("submit", (e) => {
        e.preventDefault();
        const url = new FormData(e.target).get("url").trim().replace(/\/+$/, "");
        if (!isPublicHttpsUrl(url)) {
          el.querySelector("#live-error").textContent = "Use a public https:// address. localhost, private IPs and http:// URLs are blocked by browsers on a hosted site.";
          return;
        }
        settings.baseUrl = url;
        close();
        applyMode("live");
      });
    },
  });
}

export function switchMode(mode) {
  if (mode === settings.mode) return;
  if (mode === "live" && !isLocalHost) return connectLiveDialog();
  applyMode(mode);
}

async function route() {
  cleanup?.();
  cleanup = null;
  const path = currentPath();

  if (path === "/logout") {
    session.clear();
    return navigate("/login");
  }
  // Shareable direct link: <site>/#/demo opens the dashboard with the demo account.
  if (path === "/demo") {
    settings.mode = "demo";
    ensureSeeded();
    try {
      const { accessToken } = await api.login(DEMO_LOGIN);
      session.set({ accessToken, email: DEMO_LOGIN.email });
    } catch {
      resetDemo();
      const { accessToken } = await api.login(DEMO_LOGIN);
      session.set({ accessToken, email: DEMO_LOGIN.email });
    }
    return navigate("/dashboard");
  }
  if (path === "/login" || path === "/signup") {
    if (session.get()) return navigate("/dashboard");
    app.innerHTML = "";
    cleanup = (path === "/login" ? renderLogin : renderSignup)(app);
    return;
  }
  if (!session.get()) return navigate("/login");

  const page = NAV.find((n) => n.path === path) || NAV[1];
  app.innerHTML = layout(page.path, page.label);
  wireLayout();
  cleanup = await page.render(document.getElementById("page"));
  window.scrollTo(0, 0);
}

// On the public site, fall back to Demo if Live mode points at an address a website can't reach.
if (settings.mode === "live" && !liveModeUsable()) settings.mode = "demo";
if (settings.mode === "demo") ensureSeeded();
window.addEventListener("hashchange", route);
route();
