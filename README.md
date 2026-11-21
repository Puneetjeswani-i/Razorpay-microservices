# Razorpay Clone — Microservices

A Razorpay-style payment gateway split into **Spring Boot microservices** with Spring Cloud, Kafka, Redis and PostgreSQL. It ships with observability (Zipkin, Prometheus, Grafana), Kubernetes manifests and a JMeter load test.

> The monolith version of this project lives in a separate repo: [Razorpay-monolith](https://github.com/Puneetjeswani-i/Razorpay-monolith).

### 🔗 Live demo: https://puneetjeswani-i.github.io/Razorpay-microservices/#/demo

Opens the merchant dashboard directly with a demo account. Works on any device, no install or sign-up needed.

## Frontend dashboard

`frontend/` is a merchant dashboard for the platform: plain HTML, CSS and JavaScript with no build step.

- **Dashboard:** collected volume, success rate, a 7-day volume chart and the split by payment method
- **Orders and payments:** create orders, browse payments, inspect each payment's state machine timeline, capture authorized payments
- **Test checkout:** pay by card (tokenized through vault-service first), UPI or net banking, and see every API request and response
- **API keys and webhooks:** generate and rotate keys, manage webhook endpoints, view deliveries
- **Architecture view:** the path of the latest request through the services is highlighted live

It runs in two modes:

| Mode | What it does |
|---|---|
| **Demo** (default) | A simulator in the browser that follows the same API contracts as the backend: paths, request and response bodies, JWT and API key auth, validation, the payment state machine, and the bank simulator's per-method delay and success rate. This is what the hosted link uses, so it works without a server. |
| **Live** | Calls your real API gateway. Locally that can be `http://localhost:8090`; on the hosted site it must be a public `https://` URL, e.g. a Cloudflare tunnel. See [tools/live-proxy](tools/live-proxy/README.md). |

Run it locally:

```bash
cd frontend
python -m http.server 5500
# open http://localhost:5500
```

Live mode calls the gateway straight from the browser, so the gateway must allow the dashboard's origin (CORS). `tools/live-proxy/cors_proxy.py` does that in front of the gateway without changing any backend code. The [Live mode guide](tools/live-proxy/README.md) shows how to use Live mode from the hosted site. The frontend is deployed to GitHub Pages by `.github/workflows/deploy-frontend.yml` on every push to `frontend/`.

## Architecture

```
                        ┌──────────────────────┐
    Client ───────────► │  api-gateway-service │   API key / JWT auth, routing
                        └──────────┬───────────┘
          ┌──────────────┬─────────┴──────┬────────────────────┐
          ▼              ▼                ▼                    ▼
  merchant-service  payment-service  vault-service   operations-service
          │              │                │                    │
          └────── PostgreSQL · Redis · Kafka (outbox events) ──┘

  discovery-service (Eureka)  ·  config-service (Git-backed)  ·  common-lib (shared code)
```

## Services

| Module | Responsibility |
|---|---|
| `common-lib` | Shared entities, enums, DTOs, exception handling, request context, Redis cache, rate limiting, idempotency, tracing |
| `discovery-service` | Eureka service registry (port 8761) |
| `config-service` | Spring Cloud Config server backed by a Git repo (port 8888) |
| `api-gateway-service` | Spring Cloud Gateway: single entry point that validates API keys and JWTs, then routes requests |
| `merchant-service` | Merchant signup and login, API keys, webhook configs, customers; internal APIs for other services |
| `payment-service` | Orders, payments, gateway adapters and processors, payment state machine, outbox publisher, bank simulator |
| `vault-service` | Card tokenization and charging with AES-encrypted card storage |
| `operations-service` | Webhook delivery with retry queue and DLQ, settlement engine |

Services talk to each other through **OpenFeign** clients on `/internal/**` endpoints, protected with **Resilience4j** circuit breakers. Events flow through **Kafka** using the transactional outbox pattern.

## Tech stack

- Java 25, Spring Boot 4, Spring Cloud (Gateway, Config, Netflix Eureka, OpenFeign)
- PostgreSQL, Redis, Apache Kafka
- Spring Security with JWT and API keys
- Resilience4j
- Micrometer, Zipkin, Prometheus, Grafana
- Docker, Kubernetes (kind), Kustomize
- Apache JMeter

## Public API (through the gateway)

| Method | Endpoint | Service |
|---|---|---|
| POST | `/v1/auth/signup`, `/v1/auth/login` | merchant-service |
| POST / GET | `/v1/merchants/api-keys` | merchant-service |
| POST | `/v1/merchants/api-keys/{keyId}/rotate` | merchant-service |
| CRUD | `/v1/merchants/webhooks` | merchant-service |
| POST | `/v1/orders` | payment-service |
| POST | `/v1/payments`, `/v1/payments/{paymentId}/capture` | payment-service |
| POST | `/v1/vault/tokenize` | vault-service |

## Running locally

**Quick start (Windows):** one script starts the infrastructure in Docker, builds every service and starts them in order. Add `-Tunnel` to also connect the hosted dashboard's Live mode. See [tools/run-local](tools/run-local/README.md).

```powershell
powershell -ExecutionPolicy Bypass -File tools\run-local\start-backend.ps1 -Tunnel
```

The manual steps are below.

### Prerequisites

- Java 25
- Docker
- PostgreSQL, Redis and Kafka running locally (or use the Kubernetes setup below)

### 1. Set environment variables for the config service

The config service pulls each service's configuration from a Git repository:

```bash
export GIT_CONFIG_REPO=<url of your config repo>
export GIT_USERNAME=<your git username>
export GIT_PASSWORD=<a personal access token>
```

### 2. Start the services in order

```bash
cd discovery-service && ./mvnw spring-boot:run      # 1. service registry
cd config-service && ./mvnw spring-boot:run         # 2. config server
cd common-lib && ./mvnw install                     # 3. install the shared library
# 4. then start merchant-, vault-, payment-, operations-service and api-gateway-service
```

### 3. Observability

```bash
cd observability && docker compose up -d
```

| Tool | URL |
|---|---|
| Zipkin (tracing) | http://localhost:9411 |
| Prometheus (metrics) | http://localhost:9090 |
| Grafana (dashboards) | http://localhost:3000 |

## Running on Kubernetes (kind)

```bash
kind create cluster --config k8s/kind-config.yaml
cp k8s/k8s-secrets.env.example k8s/k8s-secrets.env   # fill in your own values
kubectl apply -k k8s/
```

The gateway is exposed on http://localhost:8080. The manifests include PostgreSQL, Redis, Kafka, Kafka UI, Zipkin, Prometheus and Grafana as well as every service.

> `k8s/k8s-secrets.env` is git-ignored. Never commit real secrets.

## Load testing

`k8s/Razorpay Load Testing.jmx` is a JMeter test plan. It uses `k8s/api_keys.csv` for test API keys.

```bash
jmeter -n -t "k8s/Razorpay Load Testing.jmx"
```
