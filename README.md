# PAC File Generator

A browser-based tool for creating, validating, and downloading production-ready **Proxy Auto-Configuration (PAC)** files. No account required. All PAC logic runs entirely in the browser — the server only powers the plain-English assistant feature.

---

## What is a PAC file?

A PAC file is a JavaScript file that browsers and operating systems use to decide, for every outbound connection, whether to send traffic through a proxy server or directly to the internet. It contains a single function:

```javascript
function FindProxyForURL(url, host) {
    // returns "PROXY host:port", "DIRECT", or a failover chain
}
```

PAC files are the standard way to implement selective proxying in enterprise environments — routing internal traffic direct, sending internet traffic through a proxy, bypassing authentication servers, and much more.

---

## Features

### Builder (visual, no code)
- **Condition-based editor** — add, reorder, enable/disable rules from categorised menus
- **Proxy endpoint panel** — configure primary proxy (type, host, port) and any number of failover proxies, including `DIRECT` for fail-open
- **Quick-add buttons** — one-click insertion of the most common rules
- **Live validation** — pre-generation config checks and post-generation PAC syntax validation
- **Download** — save as `proxy.pac` or `wpad.dat`
- **Copy to clipboard**

### Assistant (plain-English input)
- Describe requirements in natural language — the server parses them into conditions
- Review and adjust detected conditions before generating
- Load results into the Builder for further editing, or generate directly

### Condition types supported

| Category | Conditions |
|---|---|
| Basic | Plain hostname bypass, Private IP bypass (RFC 1918, RFC 3330), `.local` domain bypass |
| Auth | Identity Provider bypass (Okta, Microsoft Entra ID, Google Workspace, Ping Identity), Auth service bypass |
| Protocol | FTP bypass, Protocol-based routing (HTTP / HTTPS / FTP to different proxies) |
| Domain | Domain bypass (DIRECT), Domain to specific proxy, Certificate-pinned app bypass |
| Network | Subnet-based routing, Location awareness (on-network vs off-network detection) |
| Time | Time and day-of-week based routing |
| Presets | OS Updates, CRL/OCSP, Microsoft 365, Conferencing (Zoom, WebEx, Teams) |

### Proxy chain (per condition)
Every proxy target field supports a full failover chain — choose proxy type (PROXY / HTTPS / SOCKS / SOCKS4 / SOCKS5 / DIRECT), enter host and port, and add as many failover entries as needed.

---

## Tech stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express (serves static files + one API endpoint) |
| Frontend | Vanilla JavaScript ES modules (no build step, no framework) |
| Styling | Plain CSS custom properties |
| PAC generation | 100% client-side (`pac-engine.js`) |
| PAC validation | 100% client-side (`pac-validator.js`) |

---

## Prerequisites

- **Node.js 18 or later** — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)

Check your versions:

```bash
node --version   # must be >= 18
npm --version
```

---

## Quick start (local development)

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/pac-generator.git
cd pac-generator

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open your browser at **http://localhost:3002**

The server prints the URL on startup:

```
  PAC Generator -> http://localhost:3002
```

To use a different port:

```bash
PORT=8080 npm start
```

---

## Project structure

```
pac-generator/
├── server.js               # Express server — static files + /api/parse-requirements
├── package.json
├── Dockerfile              # Container image definition
├── .dockerignore
├── .gitignore
└── public/                 # Everything here is served as static files
    ├── index.html          # Single-page app shell
    ├── css/
    │   └── style.css       # All styles (CSS custom properties, no preprocessor)
    └── js/
        ├── app.js          # Main controller — tabs, sidebar, generate button, output
        ├── builder.js      # Condition definitions + Builder UI rendering
        ├── pac-engine.js   # PAC code generator (pure function, client-side only)
        ├── pac-validator.js# Config + PAC string validator (client-side only)
        └── assistant.js    # Plain-English assistant UI
```

### Key files explained

**`server.js`**
Minimal Express server with two responsibilities:
1. Serve everything in `public/` as static files
2. Handle `POST /api/parse-requirements` — accepts a plain-English string, returns a structured JSON config (proxy endpoint, conditions, suggestions, missing fields)

**`pac-engine.js`**
Pure function `generatePAC(config) → string`. Takes the config object built by the Builder or Assistant and produces a complete, validated PAC file string. No network calls. Can be imported and used independently.

**`pac-validator.js`**
Two exported functions:
- `validateConfig(config)` — checks for missing required fields before generation
- `validatePAC(pacString)` — checks the generated PAC string (syntax, balanced braces, valid return directives, DNS caching, file size)

**`builder.js`**
Defines all condition types (`CONDITION_DEFS`), creates condition objects (`createCondition`), and renders each condition row as DOM elements (`renderConditionRow`).

---

## API reference

### `POST /api/parse-requirements`

Parses a plain-English description into a structured PAC configuration.

**Request body:**
```json
{ "text": "We need a proxy at proxy.example.com:8080. Bypass Okta for SSO..." }
```

**Response:**
```json
{
  "proxy": { "host": "proxy.example.com", "port": "8080", "type": "PROXY" },
  "failoverProxy": { "host": "proxy2.example.com", "port": "8080" },
  "conditions": [
    { "type": "idpBypass", "provider": "okta", "confidence": "high" },
    { "type": "domainBypass", "domains": [".corp.example.com"], "confidence": "medium" }
  ],
  "suggestions": [
    { "type": "plainHostname", "reason": "Recommended: bypass plain hostnames" }
  ],
  "missing": [
    { "field": "proxy", "question": "What is your proxy endpoint? (hostname:port)" }
  ]
}
```

Confidence levels: `high` (clearly stated), `medium` (inferred), `low` (detected a pattern but needs review).

---

## How to use the app

### Builder tab

1. **Set the proxy endpoint** in the left panel — select proxy type, enter hostname and port. Check "Include DIRECT fallback" to allow connections if the proxy is unreachable.
2. **Add failover proxies** with "+ Add failover proxy". Each entry supports its own proxy type (including DIRECT for fail-open).
3. **Add conditions** using the Quick Add buttons (common rules) or the Category / Condition dropdowns for full control.
4. Each condition can be **enabled/disabled** with the checkbox, or **removed** with the × button.
5. Click **Generate PAC** — the code appears in the Code tab and the Validation tab shows any issues.
6. **Copy** or **Download** the result.

### Assistant tab

1. Describe your proxy requirements in plain English in the text area.
2. Click **Parse Requirements**.
3. Review the detected proxy, conditions, suggestions, and any missing information prompts.
4. Click **Load into Builder** to transfer the config into the Builder for further editing, or **Generate PAC** to produce the file immediately.

---

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Port the server listens on |

---

## Browser compatibility

The app uses ES modules (`type="module"` script tags) and standard DOM APIs. Supported browsers:

| Browser | Minimum version |
|---|---|
| Chrome / Edge | 61+ |
| Firefox | 60+ |
| Safari | 10.1+ |

Internet Explorer is not supported.

---

## PAC file quick reference

### Return directives

| Directive | Example | Notes |
|---|---|---|
| `DIRECT` | `"DIRECT"` | Connect without a proxy |
| `PROXY` | `"PROXY proxy.example.com:8080"` | HTTP proxy |
| `SOCKS` | `"SOCKS proxy.example.com:1080"` | SOCKS (v4/v5 negotiated) |
| `SOCKS5` | `"SOCKS5 proxy.example.com:1080"` | SOCKS5 explicit |
| `HTTPS` | `"HTTPS proxy.example.com:8443"` | TLS proxy (Firefox only) |

Separate multiple directives with `;` for failover:

```javascript
return "PROXY primary.example.com:8080; PROXY backup.example.com:8080; DIRECT";
```

### Built-in PAC functions

```javascript
isPlainHostName(host)           // true if no dots (intranet)
dnsDomainIs(host, ".example.com")  // true if host ends with domain
shExpMatch(host, "*.example.com")  // shell glob match
isInNet(ip, "10.0.0.0", "255.0.0.0")  // subnet check
dnsResolve(host)                // resolves hostname to IP (cache the result!)
myIpAddress()                   // client IP (unreliable across browsers)
weekdayRange("MON", "FRI")     // day range check
timeRange(9, 17)                // hour range check
```

### Best practices enforced by this tool

- URL and host are lowercased at the top of every generated file
- `dnsResolve()` is called exactly once and stored in `resolved_ip`
- Plain hostnames are bypassed first
- RFC 1918 private IPs are bypassed before any domain rules
- IdP domains (Okta, Entra ID, etc.) are always bypassed when auth is involved
- `DIRECT` is included as the last failover unless explicitly removed
- No path-based matching (does not work in Chromium for HTTPS)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Make changes and test locally with `npm start`
4. Commit: `git commit -m "Add my change"`
5. Push and open a pull request

The project has no build step — edit the files in `public/` and refresh the browser. There is no transpilation, bundling, or framework involved.

---

## License

MIT — see [LICENSE](LICENSE) for details.
