# Run the whole backend locally

One command starts PostgreSQL, Redis, Kafka and Zipkin in Docker, builds all services, and starts them in the right order. With `-Tunnel` it also opens a public HTTPS address so the [hosted dashboard](https://puneetjeswani-i.github.io/Razorpay-microservices/)'s **Live** mode can connect.

## Prerequisites (one time)

```powershell
winget install --id EclipseAdoptium.Temurin.25.JDK -e
winget install --id Docker.DockerDesktop -e
winget install --id Cloudflare.cloudflared -e
```

Docker Desktop needs a restart the first time. After that, open it from the Start menu and wait until it shows **Engine running**. Maven is not needed: each service has its own `mvnw` wrapper.

## Start

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File tools\run-local\start-backend.ps1 -Tunnel
```

1. **Builds** `common-lib` (installed to your local Maven repository) and every service. The first build downloads dependencies and takes a few minutes; later runs can use `-SkipBuild`.
2. **Starts Docker containers:** PostgreSQL (`anuj` / `password`, with the 4 service databases), Redis, Kafka and Zipkin.
3. **Starts the services** in dependency order:

   | Service | Port |
   |---|---|
   | discovery-service (Eureka) | 8761 |
   | config-service | 8888 |
   | merchant-service | 9010 |
   | vault-service | 9040 |
   | payment-service | 9020 |
   | operations-service | 9030 |
   | api-gateway-service | **8080** |

4. **With `-Tunnel`:** starts the [CORS proxy](../live-proxy/README.md) on 8090 and a Cloudflare quick tunnel, then prints the public `https://….trycloudflare.com` address and copies it to your clipboard. Open the hosted dashboard, click **Live**, paste it and click **Connect**.

The services read their configuration from a public config repository through config-service; no credentials are needed. Logs go to `tools/run-local/logs/`.

## Stop

```powershell
powershell -ExecutionPolicy Bypass -File tools\run-local\stop-backend.ps1
```

This stops the services, proxy and tunnel, and stops the containers. Database data is kept in Docker volumes. Add `-KeepInfra` to leave the containers running.

## Local-only settings the script provides

The services were set up for Kubernetes. Running them directly on one machine needs a few values that Kubernetes would normally provide. The script supplies them without changing any service code:

| Issue | What the script does |
|---|---|
| The poms push a Docker image to a registry (Jib) during `package` | Builds with `-Djib.skip=true` |
| The config repo's local profile misspells `webhook.secret-encryption-key` as `webhoook`, so merchant-service has no `BytesEncryptor` bean | Generates a random AES-256 key once (kept in the git-ignored `.secrets/`) and passes it to merchant-service |
| `${MERCHANT_SERVICE_URI}` has no default in operations-service and the gateway (Kubernetes sets it) | Passes `MERCHANT_SERVICE_URI=http://localhost:9010` |
| Each service's connection pool allows 50 PostgreSQL connections; PostgreSQL's default limit is 100 | Starts PostgreSQL with `max_connections=300` |
| config-service needs the config repo URL and credentials | Passes the public repo URL with empty credentials |

## Memory

All of this uses roughly 5–6 GB of RAM: 7 JVMs at up to 512 MB each, plus Kafka, PostgreSQL, Redis and Docker itself. Close heavy apps before starting.
