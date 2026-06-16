// PAC Code Generation Engine
// Pure function: generatePAC(config) -> string

const IDP_DOMAINS = {
  okta: ['*.okta.com', '*.oktacdn.com'],
  entra: ['login.microsoftonline.com', 'aadcdn.msauth.net', 'aadcdn.msftauth.net'],
  google: ['accounts.google.com', '*.gstatic.com'],
  ping: ['*.pingidentity.com', '*.pingone.com'],
};

const PRESET_DOMAINS = {
  presetOsUpdates: [
    '*.windowsupdate.com', '*.update.microsoft.com',
    'download.microsoft.com', 'ntservicepack.microsoft.com',
    'wustat.windows.com', 'swscan.apple.com',
  ],
  presetCrl: [
    '*.digicert.com', '*.entrust.net',
    '*.globalsign.com', '*.verisign.com', 'ocsp.pki.goog',
  ],
  presetM365: [
    '*.lync.com', '*.office.com', '*.office365.com',
    '*.outlook.com', '*.sharepoint.com',
  ],
  presetConferencing: [
    '*.teams.microsoft.com', '*.webex.com', '*.zoom.us',
  ],
};

const PRIVATE_IP_MINIMAL = [
  ['10.0.0.0', '255.0.0.0'],
  ['127.0.0.0', '255.0.0.0'],
  ['172.16.0.0', '255.240.0.0'],
  ['192.168.0.0', '255.255.0.0'],
];

const PRIVATE_IP_STANDARD = [
  ...PRIVATE_IP_MINIMAL,
  ['169.254.0.0', '255.255.0.0'],
];

const PRIVATE_IP_COMPREHENSIVE = [
  ['0.0.0.0', '255.0.0.0'],
  ['10.0.0.0', '255.0.0.0'],
  ['127.0.0.0', '255.0.0.0'],
  ['169.254.0.0', '255.255.0.0'],
  ['172.16.0.0', '255.240.0.0'],
  ['192.0.2.0', '255.255.255.0'],
  ['192.88.99.0', '255.255.255.0'],
  ['192.168.0.0', '255.255.0.0'],
  ['198.18.0.0', '255.254.0.0'],
  ['224.0.0.0', '240.0.0.0'],
  ['240.0.0.0', '240.0.0.0'],
];

export function generatePAC(config) {
  const lines = [];
  const ind = '    ';

  lines.push('function FindProxyForURL(url, host) {');

  // Section 1: Normalization
  lines.push(`${ind}/* Normalize for consistent matching */`);
  lines.push(`${ind}url = url.toLowerCase();`);
  lines.push(`${ind}host = host.toLowerCase();`);
  lines.push('');

  // Section 2: Variables
  const needsDns = needsDnsResolve(config);
  if (needsDns) {
    lines.push(`${ind}/* Cache DNS resolution (called once to avoid redundant lookups) */`);
    lines.push(`${ind}var resolved_ip = dnsResolve(host);`);
    lines.push('');
  }

  // Sort conditions by section
  const sorted = [...config.conditions].filter(c => c.enabled !== false).sort((a, b) => a.section - b.section);

  // Section 3: Location awareness
  const locConds = sorted.filter(c => c.type === 'locationAware');
  if (locConds.length > 0) {
    const loc = locConds[0];
    lines.push(`${ind}/* Location awareness: on-network vs off-network */`);
    lines.push(`${ind}var onNetwork = (dnsResolve("${esc(loc.markerHost)}") == "${esc(loc.expectedIp)}");`);
    lines.push('');
  }

  // Section 4: Plain hostnames
  const plainConds = sorted.filter(c => c.type === 'plainHostname');
  if (plainConds.length > 0) {
    lines.push(`${ind}/* Bypass plain hostnames (intranet) */`);
    lines.push(`${ind}if (isPlainHostName(host)) return "DIRECT";`);
    lines.push('');
  }

  // Section 5: Local/private bypasses
  const localConds = sorted.filter(c => c.type === 'localDomain');
  if (localConds.length > 0) {
    lines.push(`${ind}/* Bypass .local domains */`);
    lines.push(`${ind}if (shExpMatch(host, "*.local")) return "DIRECT";`);
    lines.push('');
  }

  const privateConds = sorted.filter(c => c.type === 'privateIpBypass');
  if (privateConds.length > 0) {
    const level = privateConds[0].level || 'standard';
    const ranges = level === 'comprehensive' ? PRIVATE_IP_COMPREHENSIVE
      : level === 'minimal' ? PRIVATE_IP_MINIMAL
      : PRIVATE_IP_STANDARD;

    const label = level === 'comprehensive' ? 'private and non-routable IPs (RFC 3330)' :
      'private IPs and loopback';
    lines.push(`${ind}/* Bypass ${label} */`);
    lines.push(`${ind}if (${ranges.map((r, i) => {
      const prefix = i === 0 ? '' : `${ind}    `;
      return `${prefix}isInNet(resolved_ip, "${r[0]}", "${r[1]}")`;
    }).join(' ||\n')})`);
    lines.push(`${ind}    return "DIRECT";`);
    lines.push('');
  }

  // Section 6: IdP bypasses
  const idpConds = sorted.filter(c => c.type === 'idpBypass');
  if (idpConds.length > 0) {
    const allDomains = [];
    for (const cond of idpConds) {
      const preset = IDP_DOMAINS[cond.provider] || [];
      allDomains.push(...preset);
      if (cond.customDomains) {
        allDomains.push(...cond.customDomains.filter(d => d.trim()));
      }
    }
    const unique = [...new Set(allDomains)].sort();
    if (unique.length > 0) {
      lines.push(`${ind}/* Bypass identity provider (authentication) */`);
      lines.push(`${ind}if (${buildDomainConditions(unique).join(` ||\n${ind}    `)})`);
      lines.push(`${ind}    return "DIRECT";`);
      lines.push('');
    }
  }

  // Section 7: Auth service bypasses
  const authConds = sorted.filter(c => c.type === 'authServiceBypass');
  if (authConds.length > 0) {
    const allDomains = [];
    for (const cond of authConds) {
      if (cond.domains) allDomains.push(...cond.domains.filter(d => d.trim()));
    }
    const unique = [...new Set(allDomains)].sort();
    if (unique.length > 0) {
      lines.push(`${ind}/* Bypass authentication services */`);
      lines.push(`${ind}if (${buildDomainConditions(unique).join(` ||\n${ind}    `)})`);
      lines.push(`${ind}    return "DIRECT";`);
      lines.push('');
    }
  }

  // Section 8: Protocol bypasses
  const protoConds = sorted.filter(c => c.type === 'protocolBypass');
  if (protoConds.length > 0) {
    for (const cond of protoConds) {
      const proto = (cond.protocol || 'ftp').toLowerCase();
      lines.push(`${ind}/* Bypass ${proto.toUpperCase()} */`);
      lines.push(`${ind}if (url.substring(0, ${proto.length + 1}) == "${proto}:") return "DIRECT";`);
      lines.push('');
    }
  }

  // Section 9: Domain bypasses (DIRECT) + presets
  const domainConds = sorted.filter(c =>
    c.type === 'domainBypass' || c.type === 'presetOsUpdates' ||
    c.type === 'presetCrl' || c.type === 'presetM365' || c.type === 'presetConferencing'
  );
  // Group presets by type, then custom domains
  const presetTypes = ['presetOsUpdates', 'presetCrl', 'presetM365', 'presetConferencing'];
  const presetLabels = {
    presetOsUpdates: 'OS updates',
    presetCrl: 'Certificate revocation (CRL/OCSP)',
    presetM365: 'Productivity suites',
    presetConferencing: 'Conferencing',
  };
  for (const pt of presetTypes) {
    const matches = domainConds.filter(c => c.type === pt);
    if (matches.length > 0) {
      const domains = [...(PRESET_DOMAINS[pt] || [])].sort();
      lines.push(`${ind}/* Bypass ${presetLabels[pt]} */`);
      lines.push(`${ind}if (${buildDomainConditions(domains).join(` ||\n${ind}    `)})`);
      lines.push(`${ind}    return "DIRECT";`);
      lines.push('');
    }
  }

  const customDomainConds = domainConds.filter(c => c.type === 'domainBypass');
  if (customDomainConds.length > 0) {
    const allDomains = [];
    for (const cond of customDomainConds) {
      if (cond.domains) allDomains.push(...cond.domains.filter(d => d.trim()));
    }
    const unique = [...new Set(allDomains)].sort();
    if (unique.length > 0) {
      lines.push(`${ind}/* Bypass specified domains */`);
      const action = customDomainConds[0].action || 'DIRECT';
      if (action === 'DIRECT') {
        lines.push(`${ind}if (${buildDomainConditions(unique).join(` ||\n${ind}    `)})`);
        lines.push(`${ind}    return "DIRECT";`);
      } else {
        lines.push(`${ind}if (${buildDomainConditions(unique).join(` ||\n${ind}    `)})`);
        lines.push(`${ind}    return "${esc(action)}";`);
      }
      lines.push('');
    }
  }

  // Domain-to-proxy conditions
  const domainProxyConds = sorted.filter(c => c.type === 'domainProxy');
  for (const cond of domainProxyConds) {
    const chainStr = buildProxyChainStr(cond.proxyTarget);
    if (cond.domains && cond.domains.length > 0 && chainStr) {
      const domains = [...cond.domains].sort();
      lines.push(`${ind}/* Route specific domains to proxy */`);
      lines.push(`${ind}if (${buildDomainConditions(domains).join(` ||\n${ind}    `)})`);
      lines.push(`${ind}    return "${esc(chainStr)}";`);
      lines.push('');
    }
  }

  // Section 10: Certificate-pinned app bypasses
  const certConds = sorted.filter(c => c.type === 'certPinnedBypass');
  if (certConds.length > 0) {
    const allDomains = [];
    for (const cond of certConds) {
      if (cond.domains) allDomains.push(...cond.domains.filter(d => d.trim()));
    }
    const unique = [...new Set(allDomains)].sort();
    if (unique.length > 0) {
      lines.push(`${ind}/* Bypass certificate-pinned applications */`);
      lines.push(`${ind}if (${buildDomainConditions(unique).join(` ||\n${ind}    `)})`);
      lines.push(`${ind}    return "DIRECT";`);
      lines.push('');
    }
  }

  // Section 11: Subnet routing
  const subnetConds = sorted.filter(c => c.type === 'subnetRouting');
  if (subnetConds.length > 0) {
    lines.push(`${ind}/* Subnet-based routing */`);
    for (const cond of subnetConds) {
      const chainStr = buildProxyChainStr(cond.proxyTarget);
      if (cond.subnet && cond.mask && chainStr) {
        lines.push(`${ind}if (isInNet(myIpAddress(), "${esc(cond.subnet)}", "${esc(cond.mask)}"))`);
        lines.push(`${ind}    return "${esc(chainStr)}";`);
      }
    }
    lines.push('');
  }

  // Section 12: Time-based routing
  const timeConds = sorted.filter(c => c.type === 'timeBasedRouting');
  if (timeConds.length > 0) {
    lines.push(`${ind}/* Time-based routing */`);
    for (const cond of timeConds) {
      const parts = [];
      if (cond.dayStart && cond.dayEnd) {
        parts.push(`weekdayRange("${esc(cond.dayStart)}", "${esc(cond.dayEnd)}")`);
      }
      if (cond.hourStart !== undefined && cond.hourEnd !== undefined) {
        parts.push(`timeRange(${parseInt(cond.hourStart)}, ${parseInt(cond.hourEnd)})`);
      }
      const chainStr = buildProxyChainStr(cond.proxyTarget);
      if (parts.length > 0 && chainStr) {
        lines.push(`${ind}if (${parts.join(' && ')}) return "${esc(chainStr)}";`);
      }
    }
    lines.push('');
  }

  // Section 13: Protocol-based routing
  const protoRouteConds = sorted.filter(c => c.type === 'protocolRouting');
  if (protoRouteConds.length > 0) {
    lines.push(`${ind}/* Protocol-based routing */`);
    for (const cond of protoRouteConds) {
      const proto = (cond.protocol || 'http').toLowerCase();
      const chainStr = buildProxyChainStr(cond.proxyTarget);
      if (chainStr) {
        lines.push(`${ind}if (url.substring(0, ${proto.length + 1}) == "${proto}:") return "${esc(chainStr)}";`);
      }
    }
    lines.push('');
  }

  // Location-aware return (if location awareness is configured)
  if (locConds.length > 0) {
    const loc = locConds[0];
    const onChain = buildProxyChainStr(loc.onNetworkProxy);
    const offChain = buildProxyChainStr(loc.offNetworkProxy);
    lines.push(`${ind}/* Route based on network location */`);
    if (onChain) {
      lines.push(`${ind}if (onNetwork) return "${esc(onChain)}";`);
    }
    if (offChain) {
      lines.push(`${ind}return "${esc(offChain)}";`);
    } else {
      lines.push(`${ind}return "${buildDefaultReturn(config)}";`);
    }
  } else {
    // Section 14: Default catch-all
    lines.push(`${ind}/* Default: forward to proxy */`);
    lines.push(`${ind}return "${buildDefaultReturn(config)}";`);
  }

  lines.push('}');

  return lines.join('\n');
}

function needsDnsResolve(config) {
  return config.conditions.some(c =>
    c.enabled !== false && (c.type === 'privateIpBypass')
  );
}

function buildDefaultReturn(config) {
  const parts = [];
  const d = config.defaults;
  if (d.proxyHost && d.proxyPort) {
    parts.push(`${d.proxyType || 'PROXY'} ${d.proxyHost}:${d.proxyPort}`);
  }
  if (d.failoverProxies) {
    for (const fp of d.failoverProxies) {
      if (fp.type === 'DIRECT') {
        parts.push('DIRECT');
      } else if (fp.host && fp.port) {
        parts.push(`${fp.type || d.proxyType || 'PROXY'} ${fp.host}:${fp.port}`);
      }
    }
  }
  if (d.includeDirectFallback !== false) {
    parts.push('DIRECT');
  }
  return parts.join('; ');
}

function buildDomainConditions(domains) {
  return domains.map(d => {
    d = d.trim();
    if (d.includes('*')) {
      return `shExpMatch(host, "${esc(d)}")`;
    }
    if (d.startsWith('.')) {
      return `dnsDomainIs(host, "${esc(d)}")`;
    }
    return `host == "${esc(d)}"`;
  });
}

function buildProxyChainStr(entries) {
  if (!entries) return '';
  if (typeof entries === 'string') return entries; // legacy compat
  if (!Array.isArray(entries)) return '';
  return entries
    .filter(e => e.type === 'DIRECT' || (e.host && e.port))
    .map(e => e.type === 'DIRECT' ? 'DIRECT' : `${e.type || 'PROXY'} ${e.host}:${e.port}`)
    .join('; ');
}

function esc(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export { IDP_DOMAINS, PRESET_DOMAINS };
