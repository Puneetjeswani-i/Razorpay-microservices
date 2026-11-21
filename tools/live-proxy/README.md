# Live mode on the hosted dashboard

The hosted dashboard at https://puneetjeswani-i.github.io/Razorpay-microservices/ runs in **Demo mode** by default. **Live mode** connects it to your real backend. Because the dashboard runs in the visitor's browser, the backend must be reachable from the internet over HTTPS and must allow the site with CORS.

None of this changes the backend code:

```
Browser (github.io) ──https──► Cloudflare tunnel ──► cors_proxy.py :8090 ──► api-gateway-service :8080
```

| Piece | Why it's needed |
|---|---|
| **Cloudflare tunnel** | Gives your local gateway a public `https://` address. A website can't call `localhost`, because that would mean the visitor's own device. |
| **`cors_proxy.py`** | Answers the browser's CORS preflight (`OPTIONS`) and adds `Access-Control-*` headers. The gateway sends none, and its auth filter rejects `OPTIONS` requests. |

## Steps (Windows)

> **Shortcut:** `powershell -ExecutionPolicy Bypass -File tools\run-local\start-backend.ps1 -Tunnel` does steps 1–4 for you and prints the URL to paste. See [tools/run-local](../run-local/README.md).

**1. Start the backend** so that the API gateway is running (by default on `http://localhost:8080`). See [tools/run-local](../run-local/README.md).

**2. Start the CORS proxy** in a new terminal:

```powershell
python tools/live-proxy/cors_proxy.py
```

It listens on `http://localhost:8090` and forwards to `http://localhost:8080`. Use `--target` if your gateway runs on another port.

**3. Install cloudflared** (one time):

```powershell
winget install --id Cloudflare.cloudflared
```

**4. Open a tunnel to the proxy** in another terminal:

```powershell
cloudflared tunnel --url http://localhost:8090
```

It prints a public address such as `https://random-words.trycloudflare.com`. No Cloudflare account is needed.

**5. Connect the dashboard.** Open the hosted site, click **Live** (top right, or on the login page), paste the tunnel address and click **Connect**. Then sign up or log in with your real backend.

## Good to know

- **It works only while your PC is running** the backend, the proxy and the tunnel. When they stop, use Demo mode. The shareable `#/demo` link always works.
- **The quick-tunnel address changes** every time you start `cloudflared`. For a fixed address, create a [named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on your own domain, or deploy the backend to a server.
- **While the tunnel is open, your gateway is reachable from the internet.** The gateway still requires JWT or API key auth and applies rate limiting. Close the tunnel when you're done.
- **Allowed origins:** by default the proxy accepts the GitHub Pages site and `http://localhost:*`. To add another origin, pass `--allow-origin https://example.com` (repeatable).
- **Using the dashboard locally instead:** run `python -m http.server 5500` in `frontend/`, open http://localhost:5500, switch to Live and set the gateway URL to `http://localhost:8090`. No tunnel is needed for that.
