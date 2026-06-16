// PAC File Validator
// Validates both the config (pre-generation) and the generated PAC string (post-generation)

// Returns true if a proxyChain field (array of {type,host,port}) has at least one usable entry.
function hasValidProxy(chain) {
  if (!chain) return false;
  if (typeof chain === 'string') return chain.trim().length > 0;
  if (!Array.isArray(chain)) return false;
  return chain.some(e => e.type === 'DIRECT' || (e.host && e.host.trim() && e.port));
}

export function validateConfig(config) {
  const results = [];

  // Required: proxy endpoint
  if (!config.defaults.proxyHost || !config.defaults.proxyHost.trim()) {
    // Only error if no location-aware conditions provide proxies
    const hasLocProxy = config.conditions.some(c =>
      c.type === 'locationAware' && c.enabled !== false &&
      hasValidProxy(c.onNetworkProxy) && hasValidProxy(c.offNetworkProxy)
    );
    if (!hasLocProxy) {
      results.push({ severity: 'error', message: 'Default proxy hostname is required', field: 'proxyHost' });
    }
  }

  if (config.defaults.proxyHost && config.defaults.proxyHost.trim()) {
    if (!config.defaults.proxyPort || isNaN(parseInt(config.defaults.proxyPort))) {
      results.push({ severity: 'error', message: 'Proxy port must be a number (e.g. 8080)', field: 'proxyPort' });
    }
  }

  // Recommended: plain hostname bypass
  if (!config.conditions.some(c => c.type === 'plainHostname' && c.enabled !== false)) {
    results.push({ severity: 'warning', message: 'Plain hostname bypass is recommended (intranet resources)' });
  }

  // Recommended: private IP bypass
  if (!config.conditions.some(c => c.type === 'privateIpBypass' && c.enabled !== false)) {
    results.push({ severity: 'warning', message: 'Private IP bypass (RFC 1918) is strongly recommended' });
  }

  // Check for empty domain lists
  for (const cond of config.conditions) {
    if (cond.enabled === false) continue;

    if (cond.type === 'domainBypass' || cond.type === 'certPinnedBypass' || cond.type === 'domainProxy') {
      if (!cond.domains || cond.domains.filter(d => d.trim()).length === 0) {
        results.push({ severity: 'error', message: `Condition has no domains specified`, condId: cond.id });
      }
    }
    if (cond.type === 'domainProxy' && !hasValidProxy(cond.proxyTarget)) {
      results.push({ severity: 'error', message: 'Domain-to-proxy condition needs a proxy target', condId: cond.id });
    }
    if (cond.type === 'authServiceBypass') {
      if (!cond.domains || cond.domains.filter(d => d.trim()).length === 0) {
        results.push({ severity: 'error', message: 'Auth service bypass has no domains', condId: cond.id });
      }
    }
    if (cond.type === 'subnetRouting') {
      if (!cond.subnet || !cond.mask) {
        results.push({ severity: 'error', message: 'Subnet routing needs subnet and mask', condId: cond.id });
      }
      if (!hasValidProxy(cond.proxyTarget)) {
        results.push({ severity: 'error', message: 'Subnet routing needs a proxy target', condId: cond.id });
      }
    }
    if (cond.type === 'locationAware') {
      if (!cond.markerHost) {
        results.push({ severity: 'error', message: 'Location awareness needs a marker hostname', condId: cond.id });
      }
      if (!cond.expectedIp) {
        results.push({ severity: 'error', message: 'Location awareness needs an expected IP', condId: cond.id });
      }
    }
    if (cond.type === 'timeBasedRouting') {
      if (!hasValidProxy(cond.proxyTarget)) {
        results.push({ severity: 'error', message: 'Time-based routing needs a proxy target', condId: cond.id });
      }
    }
    if (cond.type === 'protocolRouting') {
      if (!hasValidProxy(cond.proxyTarget)) {
        results.push({ severity: 'error', message: 'Protocol routing needs a proxy target', condId: cond.id });
      }
    }
  }

  // Warn about myIpAddress usage
  if (config.conditions.some(c => c.type === 'subnetRouting' && c.enabled !== false)) {
    results.push({ severity: 'warning', message: 'myIpAddress() has inconsistent behavior across browsers and OSes' });
  }

  return results;
}

export function validatePAC(pacString) {
  const results = [];

  if (!pacString || !pacString.trim()) {
    results.push({ severity: 'error', message: 'PAC file is empty' });
    return results;
  }

  // Check function signature
  if (!pacString.trimStart().startsWith('function FindProxyForURL(url, host)')) {
    results.push({ severity: 'error', message: 'PAC must start with function FindProxyForURL(url, host)' });
  }

  // Syntax check via Function constructor
  try {
    new Function(pacString);
    results.push({ severity: 'pass', message: 'JavaScript syntax is valid' });
  } catch (e) {
    results.push({ severity: 'error', message: `Syntax error: ${e.message}` });
  }

  // Balanced braces
  let braces = 0;
  for (const ch of pacString) {
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (braces < 0) break;
  }
  if (braces !== 0) {
    results.push({ severity: 'error', message: 'Unbalanced curly braces' });
  } else {
    results.push({ severity: 'pass', message: 'Braces are balanced' });
  }

  // Balanced parentheses
  let parens = 0;
  for (const ch of pacString) {
    if (ch === '(') parens++;
    if (ch === ')') parens--;
    if (parens < 0) break;
  }
  if (parens !== 0) {
    results.push({ severity: 'error', message: 'Unbalanced parentheses' });
  } else {
    results.push({ severity: 'pass', message: 'Parentheses are balanced' });
  }

  // Check return directives
  const returnMatches = pacString.match(/return\s+"([^"]+)"/g) || [];
  for (const rm of returnMatches) {
    const val = rm.match(/return\s+"([^"]+)"/)[1];
    const parts = val.split(';').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (part === 'DIRECT') continue;
      if (/^(PROXY|SOCKS|SOCKS4|SOCKS5|HTTPS)\s+\S+:\d+$/.test(part)) continue;
      results.push({ severity: 'error', message: `Invalid return directive: "${part}"` });
    }
  }
  if (returnMatches.length > 0 && !results.some(r => r.message.startsWith('Invalid return'))) {
    results.push({ severity: 'pass', message: 'All return directives are valid' });
  }

  // Check dnsResolve is called at most once (outside comments)
  const noComments = pacString.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const dnsCount = (noComments.match(/dnsResolve\s*\(\s*host\s*\)/g) || []).length;
  if (dnsCount > 1) {
    results.push({ severity: 'warning', message: `dnsResolve(host) is called ${dnsCount} times (should be 1)` });
  } else if (dnsCount <= 1) {
    results.push({ severity: 'pass', message: 'DNS resolution is cached properly' });
  }

  // Check for path-based matching
  if (/url\.indexOf\s*\(\s*["'][^"']*\/[^"']+/.test(noComments) ||
      /shExpMatch\s*\(\s*url\s*,\s*["'][^"']*\/[^"']+\//.test(noComments)) {
    results.push({ severity: 'warning', message: 'Path-based matching detected (does not work in Chromium)' });
  }

  // File size check
  const sizeKB = new Blob([pacString]).size / 1024;
  if (sizeKB > 256) {
    results.push({ severity: 'warning', message: `File size is ${sizeKB.toFixed(1)} KB (recommended < 256 KB)` });
  } else {
    results.push({ severity: 'pass', message: `File size: ${sizeKB.toFixed(1)} KB` });
  }

  // Check for lowercase directives
  if (/return\s+"(direct|proxy|socks)/i.test(noComments) &&
      /return\s+"(direct|proxy|socks)/.test(noComments)) {
    results.push({ severity: 'error', message: 'Return directives must be uppercase (DIRECT, PROXY, SOCKS)' });
  }

  // Check normalization
  if (noComments.includes('url.toLowerCase()') && noComments.includes('host.toLowerCase()')) {
    results.push({ severity: 'pass', message: 'URL and host normalization present' });
  }

  // Has catch-all return
  const lines = pacString.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('/*'));
  const lastReturn = lines.filter(l => l.startsWith('return ')).pop();
  if (lastReturn) {
    results.push({ severity: 'pass', message: 'Catch-all return statement present' });
  } else {
    results.push({ severity: 'warning', message: 'No catch-all return statement found' });
  }

  return results;
}
