import { api } from "../api.js";
import { settings, session } from "../store.js";
import { DEMO_LOGIN } from "../mock.js";
import { esc, formData, toast, withBusy } from "../ui.js";
import { navigate, switchMode } from "../app.js";

const BUSINESS_TYPES = ["PRIVATE_LIMITED", "PUBLIC_LIMITED", "LLP", "PARTNERSHIP", "PROPRIETORSHIP", "TRUST"];

function hero() {
  return `
  <section class="auth-hero">
    <div class="row"><div class="brand-logo"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M10 24V8h8a5 5 0 010 10h-8" stroke="white" stroke-width="3.4" fill="none"/></svg></div><b style="font-size:18px;color:#fff">PayGate</b></div>
    <div class="stack" style="gap:14px">
      <h1>A payment gateway, built as microservices.</h1>
      <p class="lead">Merchant dashboard for a Razorpay-style payment platform: accept card, UPI and net banking payments, manage API keys and webhooks, and watch each request travel through the services.</p>
    </div>
    <div class="hero-points">
      <div class="hero-point">🧩<div><b>7 Spring Boot services</b><br><span class="small">API gateway, merchant, payment, vault, operations, config and discovery</span></div></div>
      <div class="hero-point">⚡<div><b>Event-driven</b><br><span class="small">Transactional outbox → Kafka → webhooks with retries and a DLQ</span></div></div>
      <div class="hero-point">🔐<div><b>Secure by design</b><br><span class="small">JWT + API key auth, rate limiting, idempotency keys, AES card vault</span></div></div>
    </div>
    <div class="chips">${["Java 25", "Spring Boot 4", "Spring Cloud", "Kafka", "Redis", "PostgreSQL", "Resilience4j", "Kubernetes", "Zipkin", "Prometheus", "Grafana"].map((t) => `<span class="chip">${t}</span>`).join("")}</div>
    <a href="https://github.com/Puneetjeswani-i/Razorpay-microservices" target="_blank" rel="noopener" style="color:#c3cdf2">View the source on GitHub →</a>
  </section>`;
}

function modeNote() {
  return settings.mode === "demo"
    ? `<div class="notice"><span>ℹ️</span><span><b>Demo mode.</b> A simulated backend runs in your browser using the same API contracts, so you can try everything without a server. <a href="#" data-to-live>Switch to Live</a></span></div>`
    : `<div class="notice warn"><span>🔌</span><span><b>Live mode</b> → <code>${esc(settings.baseUrl)}</code>. Requests go to your API gateway. <a href="#" data-to-demo>Back to Demo</a></span></div>`;
}

function wireMode(root) {
  root.querySelector("[data-to-live]")?.addEventListener("click", (e) => { e.preventDefault(); switchMode("live"); });
  root.querySelector("[data-to-demo]")?.addEventListener("click", (e) => { e.preventDefault(); switchMode("demo"); });
}

async function doLogin(email, password) {
  const { accessToken } = await api.login({ email, password });
  session.set({ accessToken, email });
  toast("Welcome back!", "success");
  navigate("/dashboard");
}

export function renderLogin(root) {
  root.innerHTML = `
  <div class="auth">
    ${hero()}
    <section class="auth-form">
      <div class="auth-card stack">
        <div><h1>Log in</h1><p class="muted" style="margin-top:6px">to your merchant dashboard</p></div>
        ${modeNote()}
        ${settings.mode === "demo" ? `<button class="btn primary block" id="demo-btn">Explore with the demo account</button><div class="divider">or log in</div>` : ""}
        <form class="stack" id="login-form" style="gap:14px">
          <label class="field">Email<input name="email" type="email" required autocomplete="email"></label>
          <label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label>
          <button class="btn ${settings.mode === "demo" ? "" : "primary"} block" type="submit">Log in</button>
        </form>
        <p class="muted small">New merchant? <a href="#/signup">Create an account</a></p>
      </div>
    </section>
  </div>`;
  wireMode(root);
  root.querySelector("#demo-btn")?.addEventListener("click", (e) => withBusy(e.currentTarget, () =>
    doLogin(DEMO_LOGIN.email, DEMO_LOGIN.password).catch((err) => toast(err.message, "error"))));
  root.querySelector("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formData(e.target);
    withBusy(e.submitter, () => doLogin(f.email, f.password).catch((err) => toast(err.message, "error")));
  });
}

export function renderSignup(root) {
  root.innerHTML = `
  <div class="auth">
    ${hero()}
    <section class="auth-form">
      <div class="auth-card stack">
        <div><h1>Create merchant account</h1><p class="muted" style="margin-top:6px"><code>POST /v1/auth/signup</code> on merchant-service</p></div>
        ${modeNote()}
        <form class="form-grid" id="signup-form">
          <label class="field full">Full name<input name="name" required maxlength="50"></label>
          <label class="field full">Email<input name="email" type="email" required></label>
          <label class="field full">Password<input name="password" type="password" required minlength="8"><span class="hint">At least 8 characters</span></label>
          <label class="field">Business name<input name="businessName" maxlength="50"></label>
          <label class="field">Business type<select name="businessType">${BUSINESS_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
          <button class="btn primary block full" type="submit">Create account</button>
        </form>
        <p class="muted small">Already have an account? <a href="#/login">Log in</a></p>
      </div>
    </section>
  </div>`;
  wireMode(root);
  root.querySelector("#signup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formData(e.target);
    withBusy(e.submitter, async () => {
      try {
        await api.signup({ ...f, businessName: f.businessName || null });
        toast("Account created", "success");
        await doLogin(f.email, f.password);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}
