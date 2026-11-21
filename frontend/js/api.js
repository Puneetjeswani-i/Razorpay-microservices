// API client. Every call goes to the API gateway exactly the way the backend expects:
//   - /v1/auth/**                      public
//   - /v1/merchants/**                 Authorization: Bearer <JWT>
//   - /v1/orders, /v1/payments, /v1/vault   Authorization: Basic base64(keyId:keySecret)
// In Demo mode the same request is handled by the in-browser simulator (mock.js).

import { settings, session, keyring, requestLog } from "./store.js";
import { handle as mockHandle } from "./mock.js";

export class ApiError extends Error {
  constructor(status, errorCode, message) {
    super(message || errorCode || `HTTP ${status}`);
    this.status = status;
    this.errorCode = errorCode;
  }
}

// Which microservice owns each route (used for the request log and the architecture view).
export function serviceFor(path) {
  if (path.startsWith("/v1/auth") || path.startsWith("/v1/merchants")) return "merchant-service";
  if (path.startsWith("/v1/orders") || path.startsWith("/v1/payments")) return "payment-service";
  if (path.startsWith("/v1/vault")) return "vault-service";
  return "api-gateway-service";
}

function authHeader(auth) {
  if (auth === "jwt") {
    const s = session.get();
    if (!s?.accessToken) throw new ApiError(401, "UNAUTHORIZED", "Please log in again.");
    return `Bearer ${s.accessToken}`;
  }
  if (auth === "key") {
    const keyId = keyring.active;
    const secret = keyId && keyring.secret(keyId);
    if (!keyId || !secret) {
      throw new ApiError(401, "NO_API_KEY", "Create an API key first (API Keys page). Orders and payments are authenticated with it.");
    }
    return `Basic ${btoa(`${keyId}:${secret}`)}`;
  }
  return null;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function request(method, path, { body, auth = "none", idempotent = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  const a = authHeader(auth);
  if (a) headers.Authorization = a;
  if (idempotent) headers["X-Idempotency-Key"] = uuid();

  const started = performance.now();
  const entry = { id: uuid(), at: new Date(), method, path, service: serviceFor(path), mode: settings.mode };

  try {
    let status, data;
    if (settings.mode === "demo") {
      ({ status, data } = await mockHandle(method, path, body, headers));
    } else {
      let res;
      try {
        res = await fetch(settings.baseUrl.replace(/\/$/, "") + path, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new ApiError(0, "NETWORK_ERROR",
          `Could not reach ${settings.baseUrl}. Is the API gateway running, and does it allow requests from this page (CORS)?`);
      }
      status = res.status;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    }
    entry.status = status;
    entry.ms = Math.round(performance.now() - started);
    requestLog.push(entry);

    if (status >= 400) {
      const msg = data?.errorDescription || data?.message || data?.error || (typeof data === "string" ? data : "");
      throw new ApiError(status, data?.errorCode, msg || `Request failed (${status})`);
    }
    return data;
  } catch (e) {
    if (entry.status === undefined) {
      entry.status = e.status || 0;
      entry.ms = Math.round(performance.now() - started);
      requestLog.push(entry);
    }
    throw e;
  }
}

// ---- Typed endpoint helpers (mirror the backend controllers) ----
export const api = {
  signup: (body) => request("POST", "/v1/auth/signup", { body }),
  login: (body) => request("POST", "/v1/auth/login", { body }),

  listApiKeys: () => request("GET", "/v1/merchants/api-keys", { auth: "jwt" }),
  createApiKey: (environment) => request("POST", "/v1/merchants/api-keys", { body: { environment }, auth: "jwt" }),
  rotateApiKey: (keyId) => request("POST", `/v1/merchants/api-keys/${encodeURIComponent(keyId)}/rotate`, { auth: "jwt" }),

  listWebhooks: () => request("GET", "/v1/merchants/webhooks", { auth: "jwt" }),
  createWebhook: (body) => request("POST", "/v1/merchants/webhooks", { body, auth: "jwt" }),
  updateWebhook: (id, body) => request("PUT", `/v1/merchants/webhooks/${id}`, { body, auth: "jwt" }),
  deleteWebhook: (id) => request("DELETE", `/v1/merchants/webhooks/${id}`, { auth: "jwt" }),

  createOrder: (body) => request("POST", "/v1/orders", { body, auth: "key", idempotent: true }),
  initPayment: (body) => request("POST", "/v1/payments", { body, auth: "key", idempotent: true }),
  capturePayment: (paymentId) => request("POST", `/v1/payments/${paymentId}/capture`, { auth: "key", idempotent: true }),

  tokenizeCard: (body) => request("POST", "/v1/vault/tokenize", { body, auth: "key" }),
};
