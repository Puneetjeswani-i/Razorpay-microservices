import { requestLog } from "../store.js";
import { esc, when } from "../ui.js";

// Node layout of the system (x, y, label, sub-label)
const NODES = {
  client: [330, 20, "Dashboard / client", "this page"],
  gateway: [330, 120, "api-gateway-service", "auth · rate limit · routing"],
  merchant: [30, 250, "merchant-service", "merchants · API keys · webhooks"],
  payment: [255, 250, "payment-service", "orders · payments · outbox"],
  vault: [480, 250, "vault-service", "card tokens · AES"],
  operations: [705, 250, "operations-service", "webhooks · settlement"],
  postgres: [140, 400, "PostgreSQL", "DB per service"],
  redis: [380, 400, "Redis", "cache · idempotency · retries"],
  kafka: [620, 400, "Kafka", "payment & order events"],
};
const EDGES = [
  ["client", "gateway"], ["gateway", "merchant"], ["gateway", "payment"], ["gateway", "vault"],
  ["payment", "vault"], ["payment", "merchant"], ["payment", "kafka"], ["kafka", "operations"], ["operations", "merchant"],
  ["merchant", "postgres"], ["payment", "postgres"], ["vault", "postgres"], ["gateway", "redis"], ["payment", "redis"],
];
// Which nodes and edges light up for a request that ends at a given service.
const PATHS = {
  "merchant-service": [["client", "gateway"], ["gateway", "merchant"], ["merchant", "postgres"], ["gateway", "redis"]],
  "vault-service": [["client", "gateway"], ["gateway", "vault"], ["vault", "postgres"], ["gateway", "redis"]],
  "payment-service": [["client", "gateway"], ["gateway", "payment"], ["payment", "postgres"], ["payment", "redis"], ["payment", "kafka"], ["kafka", "operations"], ["payment", "merchant"]],
};
const W = 180, H = 56;

function svg(active) {
  const hotEdges = new Set((PATHS[active] || []).map((e) => e.join(">")));
  const hotNodes = new Set((PATHS[active] || []).flat());
  const center = (n) => [NODES[n][0] + W / 2, NODES[n][1] + H / 2];
  const edges = EDGES.map(([a, b]) => {
    const [x1, y1] = center(a), [x2, y2] = center(b);
    const my = (y1 + y2) / 2;
    return `<path class="edge ${hotEdges.has(`${a}>${b}`) ? "hot" : ""}" d="M${x1} ${y1 + (y2 > y1 ? H / 2 : 0)} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2 - (y2 > y1 ? H / 2 : 0)}"/>`;
  }).join("");
  const nodes = Object.entries(NODES).map(([k, [x, y, label, sub]]) => `
    <g class="node ${hotNodes.has(k) ? "hot" : ""}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="10"/>
    <text x="${x + W / 2}" y="${y + 24}" text-anchor="middle">${label}</text><text class="sub" x="${x + W / 2}" y="${y + 42}" text-anchor="middle">${sub}</text></g>`).join("");
  return `<svg class="arch" viewBox="0 0 915 480" role="img" aria-label="Service architecture">${edges}${nodes}</svg>`;
}

export function renderArchitecture(root) {
  const draw = () => {
    const last = requestLog.entries[0];
    root.innerHTML = `
      <div class="page-head"><div><h1>Architecture</h1><p class="desc">Every request enters through the API gateway, which authenticates it (JWT or API key), rate-limits it in Redis and routes it to a service registered in Eureka.</p></div></div>
      <div class="card"><div class="card-head"><h3>Request path</h3><span class="spacer"></span>
        ${last ? `<span class="method ${last.method}">${last.method}</span><code>${esc(last.path)}</code><span class="muted small">→ ${esc(last.service)}</span>` : `<span class="muted small">Use the dashboard and the path of the latest request lights up here</span>`}</div>
        <div class="card-body">${svg(last?.service)}</div></div>
      <div class="grid cols-2">
        <div class="card card-body stack" style="gap:10px"><h3>Platform services</h3>
          <p><b>discovery-service</b> — Eureka registry all services register with.</p>
          <p><b>config-service</b> — Spring Cloud Config, serves each service's configuration from a Git repo.</p>
          <p><b>common-lib</b> — shared exceptions, rate limiters, idempotency filter, Redis cache and tracing.</p>
          <p><b>Observability</b> — Zipkin traces, Prometheus metrics and Grafana dashboards.</p>
        </div>
        <div class="card card-body stack" style="gap:10px"><h3>Patterns used</h3>
          <p><b>Transactional outbox</b> — payment events are committed with the payment and published to Kafka by a poller.</p>
          <p><b>State machine</b> — payments only move along allowed transitions; every transition is logged.</p>
          <p><b>Strategy + adapter</b> — one processor and gateway adapter per payment method.</p>
          <p><b>Resilience4j</b> — circuit breakers on inter-service Feign calls.</p>
          <p><b>Idempotency</b> — <code>X-Idempotency-Key</code> requests are de-duplicated in Redis.</p>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Recent requests</h3></div>
        ${requestLog.entries.length ? requestLog.entries.slice(0, 8).map((e) => `<div class="log-row"><span class="method ${e.method}">${e.method}</span><code>${esc(e.path)}</code><span class="muted">${esc(e.service)}</span><span class="badge ${e.status < 400 ? "success" : "danger"}">${e.status || "ERR"} · ${e.ms}ms</span></div>`).join("") : `<div class="empty">No requests yet in this session.</div>`}
      </div>
      <p class="muted small">Last updated ${when(new Date())}</p>`;
  };
  draw();
  window.addEventListener("request-logged", draw);
  return () => window.removeEventListener("request-logged", draw);
}
