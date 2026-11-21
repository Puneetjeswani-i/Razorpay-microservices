import { history, settings } from "../store.js";
import { badge, esc, inr, shortId, when } from "../ui.js";

function stats(h) {
  const pays = h.payments;
  const captured = pays.filter((p) => ["CAPTURED", "SETTLED"].includes(p.status));
  const failed = pays.filter((p) => p.status === "FAILED");
  const finished = captured.length + failed.length + pays.filter((p) => p.status === "AUTHORIZED").length;
  const volume = captured.reduce((s, p) => s + (p.amount?.amountUnits || 0), 0);
  return {
    volume,
    count: captured.length,
    successRate: finished ? Math.round(((finished - failed.length) / finished) * 100) : 0,
    orders: h.orders.length,
    avg: captured.length ? Math.round(volume / captured.length) : 0,
  };
}

function chart(payments) {
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
    return { d, ok: 0, fail: 0 };
  });
  for (const p of payments) {
    const t = new Date(p.createdAt); t.setHours(0, 0, 0, 0);
    const slot = days.find((x) => x.d.getTime() === t.getTime());
    if (!slot) continue;
    if (["CAPTURED", "SETTLED", "AUTHORIZED"].includes(p.status)) slot.ok += p.amount.amountUnits / 100;
    else if (p.status === "FAILED") slot.fail += p.amount.amountUnits / 100;
  }
  const max = Math.max(1000, ...days.map((x) => x.ok + x.fail));
  const W = 640, H = 220, pad = 34, bw = (W - pad * 2) / 7;
  const y = (v) => H - 26 - (v / max) * (H - 50);
  const grid = [0, 0.5, 1].map((f) => `<line class="grid-line" x1="${pad}" x2="${W - 8}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="0" y="${y(max * f) + 4}">${max * f >= 1000 ? `${Math.round((max * f) / 1000)}k` : Math.round(max * f)}</text>`).join("");
  const bars = days.map((x, i) => {
    const bx = pad + i * bw + bw * 0.22, w = bw * 0.56;
    return `<rect class="bar" rx="4" x="${bx}" y="${y(x.ok)}" width="${w}" height="${H - 26 - y(x.ok)}"><title>₹${x.ok.toLocaleString("en-IN")} successful</title></rect>
      <rect class="bar fail" rx="4" x="${bx}" y="${y(x.ok + x.fail)}" width="${w}" height="${y(x.ok) - y(x.ok + x.fail)}"><title>₹${x.fail.toLocaleString("en-IN")} failed</title></rect>
      <text x="${bx + w / 2}" y="${H - 8}" text-anchor="middle">${x.d.toLocaleDateString("en-IN", { weekday: "short" })}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Payment volume over the last 7 days">${grid}${bars}</svg>`;
}

function methodSplit(payments) {
  const ok = payments.filter((p) => ["CAPTURED", "SETTLED", "AUTHORIZED"].includes(p.status));
  const total = ok.length || 1;
  return ["UPI", "CARD", "NETBANKING"].map((m) => {
    const n = ok.filter((p) => p.method === m).length;
    const pct = Math.round((n / total) * 100);
    return `<div class="stack" style="gap:6px"><div class="row"><b>${m}</b><span class="spacer"></span><span class="muted">${n} · ${pct}%</span></div>
      <div style="height:8px;background:var(--surface-2);border-radius:99px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--brand)"></div></div></div>`;
  }).join("");
}

export function renderDashboard(root) {
  const draw = () => {
    const h = history.load();
    const s = stats(h);
    root.innerHTML = `
      <div class="page-head"><div><h1>Dashboard</h1><p class="desc">Activity from the orders and payments this dashboard has created${settings.mode === "demo" ? " (demo data)" : ""}.</p></div>
        <span class="spacer"></span><a class="btn primary" href="#/checkout">+ New test payment</a></div>
      <div class="grid cols-4">
        <div class="card card-body stat"><div class="label">Collected</div><div class="value">${inr(s.volume)}</div><div class="sub">${s.count} captured payments</div></div>
        <div class="card card-body stat"><div class="label">Success rate</div><div class="value">${s.successRate}%</div><div class="sub">authorized ÷ attempted</div></div>
        <div class="card card-body stat"><div class="label">Orders</div><div class="value">${s.orders}</div><div class="sub">created via /v1/orders</div></div>
        <div class="card card-body stat"><div class="label">Average ticket</div><div class="value">${inr(s.avg)}</div><div class="sub">per captured payment</div></div>
      </div>
      <div class="grid dash-split">
        <div class="card"><div class="card-head"><h3>Payment volume · last 7 days</h3><span class="spacer"></span><div class="legend"><span>Successful</span><span class="fail">Failed</span></div></div>
          <div class="card-body">${chart(h.payments)}</div></div>
        <div class="card"><div class="card-head"><h3>Payment methods</h3></div><div class="card-body stack">${methodSplit(h.payments)}</div></div>
      </div>
      <div class="card"><div class="card-head"><h3>Recent payments</h3><span class="spacer"></span><a href="#/payments" class="small">View all →</a></div>
        <div class="table-wrap">${h.payments.length ? `<table><thead><tr><th>Payment</th><th>Amount</th><th>Method</th><th>Status</th><th>Created</th></tr></thead><tbody>
          ${h.payments.slice(0, 6).map((p) => `<tr><td class="mono">${esc(shortId(p.id))}</td><td><b>${inr(p.amount)}</b></td><td>${esc(p.method)}</td><td>${badge(p.status)}</td><td class="muted">${when(p.createdAt)}</td></tr>`).join("")}
          </tbody></table>` : `<div class="empty">No payments yet. <a href="#/checkout">Make a test payment</a>.</div>`}</div></div>`;
  };
  draw();
  window.addEventListener("history-changed", draw);
  return () => window.removeEventListener("history-changed", draw);
}
