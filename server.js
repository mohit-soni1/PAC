import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// --- Plain English Requirements Parser ---

app.post('/api/parse-requirements', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'No requirements text provided' });
  }

  const input = text.toLowerCase();
  const parsed = { proxy: null, conditions: [], suggestions: [], missing: [] };

  // Extract proxy host:port
  const proxyMatch = text.match(/(?:proxy[:\s]+|PROXY\s+)([\w.-]+):(\d+)/i)
    || text.match(/([\w.-]+\.(?:com|net|org|io|cloud|dev)(?:\.[\w]+)*):(\d+)/i);
  if (proxyMatch) {
    parsed.proxy = { host: proxyMatch[1], port: proxyMatch[2], type: 'PROXY' };
  }

  // Detect proxy type
  if (/socks5/i.test(input)) parsed.proxy && (parsed.proxy.type = 'SOCKS5');
  else if (/socks4/i.test(input)) parsed.proxy && (parsed.proxy.type = 'SOCKS4');
  else if (/socks/i.test(input)) parsed.proxy && (parsed.proxy.type = 'SOCKS');
  else if (/https\s+proxy|proxy\s+type.*https/i.test(input)) parsed.proxy && (parsed.proxy.type = 'HTTPS');

  // IdP detection
  if (/okta/i.test(input)) {
    parsed.conditions.push({ type: 'idpBypass', provider: 'okta', confidence: 'high' });
  }
  if (/entra|azure\s*ad|microsoftonline/i.test(input)) {
    parsed.conditions.push({ type: 'idpBypass', provider: 'entra', confidence: 'high' });
  }
  if (/google\s*workspace|google\s*sso|accounts\.google/i.test(input)) {
    parsed.conditions.push({ type: 'idpBypass', provider: 'google', confidence: 'high' });
  }
  if (/ping\s*identity|ping\s*one|pingidentity/i.test(input)) {
    parsed.conditions.push({ type: 'idpBypass', provider: 'ping', confidence: 'high' });
  }

  // FTP bypass
  if (/ftp.*(direct|bypass)|bypass.*ftp|no\s*proxy.*ftp/i.test(input)) {
    parsed.conditions.push({ type: 'protocolBypass', protocol: 'ftp', confidence: 'high' });
  }

  // Domain bypasses - find domain patterns near bypass/direct/exclude keywords
  // Collect all host:port FQDNs so we can exclude them from bypass domains
  const proxyHosts = new Set();
  for (const m of text.matchAll(/([\w][\w.-]+):\d{2,5}/g)) {
    proxyHosts.add(m[1].toLowerCase());
  }

  const domainPatterns = text.match(/(?:\*\.)?[\w][\w.-]*\.(?:com|net|org|io|local|internal|corp|dev|edu|gov|cloud|example|intranet)(?:\.[\w]+)*/gi) || [];
  const bypassDomains = [];
  for (const d of domainPatterns) {
    // Skip any domain that appears as a proxy host (host:port pair)
    if (proxyHosts.has(d.toLowerCase())) continue;
    // Skip IdP domains already captured
    if (/okta|oktacdn|microsoftonline|msauth|gstatic|pingidentity|pingone/i.test(d)) continue;
    const normalized = d.startsWith('.') ? d : (d.startsWith('*.') ? d : '.' + d);
    if (!bypassDomains.includes(normalized)) bypassDomains.push(normalized);
  }
  if (bypassDomains.length > 0) {
    parsed.conditions.push({ type: 'domainBypass', domains: bypassDomains, confidence: 'medium' });
  }

  // Subnet routing
  const subnetMatches = [...text.matchAll(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})/g)];
  for (const m of subnetMatches) {
    const cidr = parseInt(m[2]);
    const mask = cidrToMask(cidr);
    // Look for proxy near this subnet mention
    const context = text.substring(Math.max(0, m.index - 100), m.index + m[0].length + 100);
    const proxyInContext = context.match(/([\w.-]+):(\d{2,5})/);
    parsed.conditions.push({
      type: 'subnetRouting',
      subnet: m[1],
      mask: mask,
      proxy: proxyInContext ? `PROXY ${proxyInContext[1]}:${proxyInContext[2]}` : null,
      confidence: 'medium'
    });
  }

  // Time-based routing
  if (/business\s*hours|work\s*hours|weekday|9\s*(?:am|to)\s*5|time.*based/i.test(input)) {
    parsed.conditions.push({ type: 'timeBasedRouting', confidence: 'low' });
  }

  // Location awareness
  if (/on.?network|off.?network|location.?aware|split.?tunnel/i.test(input)) {
    parsed.conditions.push({ type: 'locationAware', confidence: 'low' });
  }

  // Conferencing bypass
  if (/zoom|webex|teams.*bypass|bypass.*(?:zoom|webex|teams)|conferencing/i.test(input)) {
    parsed.conditions.push({ type: 'presetConferencing', confidence: 'high' });
  }

  // M365 bypass
  if (/microsoft\s*365|m365|office\s*365|o365/i.test(input)) {
    parsed.conditions.push({ type: 'presetM365', confidence: 'high' });
  }

  // OS updates bypass
  if (/windows\s*update|os\s*update|apple\s*update|software\s*update/i.test(input)) {
    parsed.conditions.push({ type: 'presetOsUpdates', confidence: 'high' });
  }

  // Certificate pinned
  if (/certificate.?pin|cert.?pin|tls.?inspect/i.test(input)) {
    parsed.conditions.push({ type: 'certPinnedBypass', domains: [], confidence: 'low' });
  }

  // Failover detection
  const failoverMatch = text.match(/failover.*?([\w.-]+):(\d+)/i)
    || text.match(/([\w.-]+):(\d+).*?failover/i)
    || text.match(/secondary.*?proxy.*?([\w.-]+):(\d+)/i)
    || text.match(/backup.*?proxy.*?([\w.-]+):(\d+)/i);
  if (failoverMatch) {
    parsed.failoverProxy = { host: failoverMatch[1], port: failoverMatch[2] };
  }

  // Suggestions for best practices
  const hasPlainHostname = parsed.conditions.some(c => c.type === 'plainHostname');
  const hasPrivateIp = parsed.conditions.some(c => c.type === 'privateIpBypass');
  if (!hasPlainHostname) {
    parsed.suggestions.push({ type: 'plainHostname', reason: 'Recommended: bypass plain hostnames (intranet resources)' });
  }
  if (!hasPrivateIp) {
    parsed.suggestions.push({ type: 'privateIpBypass', reason: 'Recommended: bypass private IP ranges (RFC 1918)' });
  }

  // Missing info
  if (!parsed.proxy) {
    parsed.missing.push({ field: 'proxy', question: 'What is your proxy endpoint? (hostname:port)' });
  }
  if (parsed.conditions.some(c => c.type === 'subnetRouting' && !c.proxy)) {
    parsed.missing.push({ field: 'subnetProxy', question: 'What proxy should subnet-based traffic use?' });
  }
  if (parsed.conditions.some(c => c.type === 'locationAware')) {
    parsed.missing.push({ field: 'locationMarker', question: 'What internal DNS hostname should be used for on-network detection? (and its expected IP)' });
  }
  if (parsed.conditions.some(c => c.type === 'certPinnedBypass' && (!c.domains || c.domains.length === 0))) {
    parsed.missing.push({ field: 'certPinnedDomains', question: 'Which certificate-pinned application domains need to be bypassed?' });
  }

  res.json(parsed);
});

function cidrToMask(cidr) {
  const mask = [];
  for (let i = 0; i < 4; i++) {
    const bits = Math.min(cidr, 8);
    mask.push(256 - Math.pow(2, 8 - bits));
    cidr = Math.max(0, cidr - 8);
  }
  return mask.join('.');
}

// --- Start ---

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`\n  PAC Generator -> http://localhost:${PORT}\n`);
});
