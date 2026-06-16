// Assistant UI Controller
// Plain English input -> parse -> show results -> generate or load into builder

import { IDP_DOMAINS, PRESET_DOMAINS } from './pac-engine.js';
import { createCondition } from './builder.js';

export function initAssistant(panel, onLoadToBuilder, onGenerate) {
  panel.innerHTML = '';

  const ta = document.createElement('textarea');
  ta.className = 'assistant-input';
  ta.placeholder = `Describe your PAC file requirements in plain English.\n\nExample:\nWe need a proxy at proxy.example.com:8080.\nBypass Okta for SSO authentication.\nInternal domains .corp.acme.com and .internal.acme.com should go direct.\nFTP should go direct.\nBypass Zoom and WebEx for conferencing.\nSubnet 10.1.0.0/16 should use proxy1.example.com:8080.\nInclude a failover proxy at proxy2.example.com:8080.`;
  panel.appendChild(ta);

  const actions = document.createElement('div');
  actions.className = 'assistant-actions';

  const parseBtn = document.createElement('button');
  parseBtn.className = 'btn primary';
  parseBtn.textContent = 'Parse Requirements';
  actions.appendChild(parseBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    ta.value = '';
    resultsDiv.innerHTML = '';
  });
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'parsed-results';
  panel.appendChild(resultsDiv);

  parseBtn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;

    parseBtn.disabled = true;
    parseBtn.textContent = 'Parsing...';
    resultsDiv.innerHTML = '';

    try {
      const resp = await fetch('/api/parse-requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await resp.json();
      if (data.error) {
        resultsDiv.innerHTML = `<div class="missing-item"><span class="icon">!</span> ${data.error}</div>`;
        return;
      }
      renderResults(data, resultsDiv, onLoadToBuilder, onGenerate);
    } catch (err) {
      resultsDiv.innerHTML = `<div class="missing-item"><span class="icon">!</span> Failed to parse: ${err.message}</div>`;
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = 'Parse Requirements';
    }
  });
}

function renderResults(data, container, onLoadToBuilder, onGenerate) {
  container.innerHTML = '';

  // Proxy info
  if (data.proxy) {
    const div = document.createElement('div');
    div.className = 'parsed-item';
    div.innerHTML = `<input type="checkbox" checked disabled>
      <span class="parsed-label">Proxy: ${data.proxy.type} ${data.proxy.host}:${data.proxy.port}</span>
      <span class="parsed-confidence high">detected</span>`;
    container.appendChild(div);
  }

  // Failover
  if (data.failoverProxy) {
    const div = document.createElement('div');
    div.className = 'parsed-item';
    div.innerHTML = `<input type="checkbox" checked disabled>
      <span class="parsed-label">Failover proxy: ${data.failoverProxy.host}:${data.failoverProxy.port}</span>
      <span class="parsed-confidence high">detected</span>`;
    container.appendChild(div);
  }

  // Parsed conditions
  const condCheckboxes = [];
  for (const cond of (data.conditions || [])) {
    const div = document.createElement('div');
    div.className = 'parsed-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.dataset.index = condCheckboxes.length;
    condCheckboxes.push({ checkbox: chk, condition: cond });

    const label = document.createElement('span');
    label.className = 'parsed-label';
    label.textContent = describeCondition(cond);

    const conf = document.createElement('span');
    conf.className = 'parsed-confidence ' + (cond.confidence || 'medium');
    conf.textContent = cond.confidence || 'medium';

    div.appendChild(chk);
    div.appendChild(label);
    div.appendChild(conf);
    container.appendChild(div);
  }

  // Suggestions
  for (const sug of (data.suggestions || [])) {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `<span class="icon">i</span> <span>${sug.reason}</span>`;

    const btn = document.createElement('button');
    btn.className = 'btn sm';
    btn.textContent = 'Add';
    btn.addEventListener('click', () => {
      const newCond = { type: sug.type, confidence: 'added' };
      condCheckboxes.push({ checkbox: null, condition: newCond, accepted: true });
      div.innerHTML = `<span class="icon" style="color:var(--green)">+</span> <span>${sug.reason} - Added</span>`;
    });
    div.appendChild(btn);
    container.appendChild(div);
  }

  // Missing info
  const missingInputs = {};
  for (const miss of (data.missing || [])) {
    const div = document.createElement('div');
    div.className = 'missing-item';
    div.innerHTML = `<span class="icon">!</span> <span>${miss.question}</span>`;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Enter value...';
    missingInputs[miss.field] = inp;
    div.appendChild(inp);
    container.appendChild(div);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'assistant-actions';
  actions.style.marginTop = '14px';

  const loadBtn = document.createElement('button');
  loadBtn.className = 'btn';
  loadBtn.textContent = 'Load into Builder';
  loadBtn.addEventListener('click', () => {
    const result = buildConfigFromParsed(data, condCheckboxes, missingInputs);
    onLoadToBuilder(result);
  });

  const genBtn = document.createElement('button');
  genBtn.className = 'btn primary';
  genBtn.textContent = 'Generate PAC';
  genBtn.addEventListener('click', () => {
    const result = buildConfigFromParsed(data, condCheckboxes, missingInputs);
    onGenerate(result);
  });

  actions.appendChild(loadBtn);
  actions.appendChild(genBtn);
  container.appendChild(actions);
}

function buildConfigFromParsed(data, condCheckboxes, missingInputs) {
  const config = {
    defaults: {
      proxyHost: data.proxy ? data.proxy.host : (missingInputs.proxy ? parseProxyInput(missingInputs.proxy.value).host : ''),
      proxyPort: data.proxy ? data.proxy.port : (missingInputs.proxy ? parseProxyInput(missingInputs.proxy.value).port : ''),
      proxyType: data.proxy ? data.proxy.type : 'PROXY',
      failoverProxies: [],
      includeDirectFallback: true,
    },
    conditions: [],
  };

  if (data.failoverProxy) {
    config.defaults.failoverProxies.push({
      host: data.failoverProxy.host,
      port: data.failoverProxy.port,
      type: config.defaults.proxyType,
    });
  }

  // Add accepted conditions
  for (const entry of condCheckboxes) {
    const include = entry.accepted || (entry.checkbox && entry.checkbox.checked);
    if (!include) continue;

    const cond = createCondition(entry.condition.type);
    if (!cond) continue;

    // Copy parsed data into condition
    if (entry.condition.domains) cond.domains = entry.condition.domains;
    if (entry.condition.provider) cond.provider = entry.condition.provider;
    if (entry.condition.protocol) cond.protocol = entry.condition.protocol;
    if (entry.condition.subnet) cond.subnet = entry.condition.subnet;
    if (entry.condition.mask) cond.mask = entry.condition.mask;
    if (entry.condition.proxy) cond.proxyTarget = entry.condition.proxy;

    config.conditions.push(cond);
  }

  // Add best-practice defaults if not already present
  const types = config.conditions.map(c => c.type);
  if (!types.includes('plainHostname')) {
    const c = createCondition('plainHostname');
    if (c) config.conditions.unshift(c);
  }
  if (!types.includes('privateIpBypass')) {
    const c = createCondition('privateIpBypass');
    if (c) config.conditions.splice(1, 0, c);
  }
  if (!types.includes('localDomain')) {
    const c = createCondition('localDomain');
    if (c) config.conditions.splice(2, 0, c);
  }

  return config;
}

function parseProxyInput(val) {
  if (!val) return { host: '', port: '' };
  const match = val.match(/([\w.-]+):(\d+)/);
  return match ? { host: match[1], port: match[2] } : { host: val, port: '8080' };
}

function describeCondition(cond) {
  switch (cond.type) {
    case 'idpBypass': {
      const domains = IDP_DOMAINS[cond.provider] || [];
      return `IdP bypass: ${cond.provider} (${domains.join(', ')})`;
    }
    case 'domainBypass':
      return `Domain bypass: ${(cond.domains || []).join(', ')}`;
    case 'protocolBypass':
      return `Protocol bypass: ${(cond.protocol || 'FTP').toUpperCase()}`;
    case 'subnetRouting':
      return `Subnet routing: ${cond.subnet}/${cond.mask || '?'} -> ${cond.proxy || 'proxy'}`;
    case 'timeBasedRouting':
      return 'Time-based routing (needs configuration)';
    case 'locationAware':
      return 'Location awareness (needs configuration)';
    case 'certPinnedBypass':
      return `Cert-pinned bypass: ${(cond.domains || []).join(', ') || 'needs domains'}`;
    case 'presetConferencing':
      return 'Conferencing bypass (Zoom, WebEx, Teams)';
    case 'presetM365':
      return 'Productivity suites bypass (M365)';
    case 'presetOsUpdates':
      return 'OS updates bypass (Windows, Apple)';
    case 'presetCrl':
      return 'CRL/OCSP bypass';
    case 'plainHostname':
      return 'Plain hostname bypass';
    case 'privateIpBypass':
      return 'Private IP bypass (RFC 1918)';
    default:
      return cond.type;
  }
}
