// Builder UI Controller
// Manages condition rows in the dropdown builder

import { IDP_DOMAINS, PRESET_DOMAINS } from './pac-engine.js';

const CONDITION_DEFS = {
  plainHostname: {
    label: 'Plain hostname bypass',
    category: 'Basic',
    section: 4,
    fields: [],
    hint: 'Bypass proxy for intranet names without dots (e.g. http://intranet)',
  },
  privateIpBypass: {
    label: 'Private IP bypass (RFC 1918)',
    category: 'Basic',
    section: 5,
    fields: [
      { key: 'level', type: 'select', label: 'Level', options: [
        { value: 'minimal', label: 'Minimal (10.x, 172.16-31.x, 192.168.x, 127.x)' },
        { value: 'standard', label: 'Standard (+ link-local 169.254.x)' },
        { value: 'comprehensive', label: 'Comprehensive (all RFC 3330 ranges)' },
      ], default: 'standard' },
    ],
    hint: 'Bypass proxy for private/non-routable IP addresses',
  },
  localDomain: {
    label: 'Local domain (.local) bypass',
    category: 'Basic',
    section: 5,
    fields: [],
    hint: 'Bypass proxy for *.local hostnames',
  },
  idpBypass: {
    label: 'Identity Provider (IdP) bypass',
    category: 'Auth',
    section: 6,
    fields: [
      { key: 'provider', type: 'select', label: 'Provider', options: [
        { value: 'okta', label: 'Okta' },
        { value: 'entra', label: 'Microsoft Entra ID' },
        { value: 'google', label: 'Google Workspace' },
        { value: 'ping', label: 'Ping Identity' },
        { value: 'custom', label: 'Custom' },
      ]},
      { key: 'customDomains', type: 'textarea', label: 'Additional domains (one per line)', showWhen: 'always' },
    ],
    hint: 'CRITICAL: Prevents authentication loops when proxy requires auth',
  },
  authServiceBypass: {
    label: 'Auth service bypass',
    category: 'Auth',
    section: 7,
    fields: [
      { key: 'domains', type: 'textarea', label: 'Domains (one per line)', placeholder: '*.auth.example.com\n*.sso.example.com' },
    ],
    hint: 'Bypass authentication cache or SSO service domains',
  },
  protocolBypass: {
    label: 'FTP bypass',
    category: 'Protocol',
    section: 8,
    fields: [],
    hint: 'Send FTP traffic directly, bypassing the proxy',
  },
  domainBypass: {
    label: 'Domain bypass (DIRECT)',
    category: 'Domain',
    section: 9,
    fields: [
      { key: 'matchType', type: 'select', label: 'Match type', options: [
        { value: 'auto', label: 'Auto-detect' },
        { value: 'suffix', label: 'Domain suffix (dnsDomainIs)' },
        { value: 'wildcard', label: 'Wildcard (shExpMatch)' },
        { value: 'exact', label: 'Exact match' },
      ], default: 'auto' },
      { key: 'domains', type: 'textarea', label: 'Domains (one per line)', placeholder: '.corp.example.com\n.internal.example.com\n*.partner.com' },
    ],
    hint: 'Bypass proxy for specified domains',
  },
  domainProxy: {
    label: 'Domain to specific proxy',
    category: 'Domain',
    section: 9,
    fields: [
      { key: 'domains', type: 'textarea', label: 'Domains (one per line)', placeholder: '*.special.com' },
      { key: 'proxyTarget', type: 'proxyChain', label: 'Proxy target' },
    ],
    hint: 'Route specific domains to a different proxy',
  },
  certPinnedBypass: {
    label: 'Certificate-pinned app bypass',
    category: 'Domain',
    section: 10,
    fields: [
      { key: 'domains', type: 'textarea', label: 'Domains (one per line)', placeholder: '*.banking-app.com' },
    ],
    hint: 'Bypass for apps that reject TLS inspection certificates',
  },
  subnetRouting: {
    label: 'Subnet-based routing',
    category: 'Network',
    section: 11,
    fields: [
      { key: 'subnet', type: 'text', label: 'Subnet', placeholder: '10.1.0.0' },
      { key: 'mask', type: 'text', label: 'Mask', placeholder: '255.255.0.0' },
      { key: 'proxyTarget', type: 'proxyChain', label: 'Proxy target' },
    ],
    hint: 'Route traffic based on client IP subnet (uses myIpAddress)',
  },
  locationAware: {
    label: 'Location awareness (on/off network)',
    category: 'Network',
    section: 3,
    fields: [
      { key: 'markerHost', type: 'text', label: 'Internal DNS marker', placeholder: 'pac-marker.corp.example.com' },
      { key: 'expectedIp', type: 'text', label: 'Expected IP', placeholder: '10.0.0.5' },
      { key: 'onNetworkProxy', type: 'proxyChain', label: 'On-network proxy' },
      { key: 'offNetworkProxy', type: 'proxyChain', label: 'Off-network proxy' },
    ],
    hint: 'Detect on-network via internal DNS, route accordingly',
  },
  timeBasedRouting: {
    label: 'Time-based routing',
    category: 'Time',
    section: 12,
    fields: [
      { key: 'dayStart', type: 'select', label: 'From day', options: [
        {value:'MON',label:'Monday'},{value:'TUE',label:'Tuesday'},{value:'WED',label:'Wednesday'},
        {value:'THU',label:'Thursday'},{value:'FRI',label:'Friday'},{value:'SAT',label:'Saturday'},{value:'SUN',label:'Sunday'},
      ], default: 'MON' },
      { key: 'dayEnd', type: 'select', label: 'To day', options: [
        {value:'MON',label:'Monday'},{value:'TUE',label:'Tuesday'},{value:'WED',label:'Wednesday'},
        {value:'THU',label:'Thursday'},{value:'FRI',label:'Friday'},{value:'SAT',label:'Saturday'},{value:'SUN',label:'Sunday'},
      ], default: 'FRI' },
      { key: 'hourStart', type: 'text', label: 'From hour (0-23)', placeholder: '9' },
      { key: 'hourEnd', type: 'text', label: 'To hour (0-23)', placeholder: '17' },
      { key: 'proxyTarget', type: 'proxyChain', label: 'Proxy target' },
    ],
    hint: 'Route traffic differently by day/time',
  },
  protocolRouting: {
    label: 'Protocol-based routing',
    category: 'Protocol',
    section: 13,
    fields: [
      { key: 'protocol', type: 'select', label: 'Protocol', options: [
        { value: 'http', label: 'HTTP' },
        { value: 'https', label: 'HTTPS' },
        { value: 'ftp', label: 'FTP' },
      ]},
      { key: 'proxyTarget', type: 'proxyChain', label: 'Proxy target' },
    ],
    hint: 'Route different protocols to different proxies',
  },
  presetOsUpdates: {
    label: 'OS Updates bypass',
    category: 'Presets',
    section: 9,
    fields: [],
    hint: 'Bypass Windows Update and Apple Software Update domains',
  },
  presetCrl: {
    label: 'CRL/OCSP bypass',
    category: 'Presets',
    section: 9,
    fields: [],
    hint: 'Bypass certificate revocation check domains',
  },
  presetM365: {
    label: 'Productivity suites bypass',
    category: 'Presets',
    section: 9,
    fields: [],
    hint: 'Bypass Office 365, Outlook, SharePoint domains',
  },
  presetConferencing: {
    label: 'Conferencing bypass',
    category: 'Presets',
    section: 9,
    fields: [],
    hint: 'Bypass Zoom, WebEx, Teams domains',
  },
};

const CATEGORIES = ['Basic', 'Auth', 'Protocol', 'Domain', 'Network', 'Time', 'Presets'];

let conditionCounter = 0;

export function getConditionDefs() { return CONDITION_DEFS; }
export function getCategories() { return CATEGORIES; }

export function createCondition(type) {
  const def = CONDITION_DEFS[type];
  if (!def) return null;

  const cond = {
    id: 'cond-' + (++conditionCounter),
    type,
    section: def.section,
    enabled: true,
  };

  // Set defaults for fields
  for (const f of def.fields) {
    if (f.default !== undefined) {
      cond[f.key] = f.default;
    } else if (f.type === 'textarea') {
      cond[f.key] = [];
    } else if (f.type === 'proxyChain') {
      cond[f.key] = [{ type: 'PROXY', host: '', port: '8080' }];
    } else {
      cond[f.key] = f.options ? f.options[0].value : '';
    }
  }

  // Pre-populate IdP domains
  if (type === 'idpBypass') {
    cond.provider = 'okta';
    cond.customDomains = [];
  }

  return cond;
}

export function renderConditionRow(cond, container, onChange, onDelete) {
  const def = CONDITION_DEFS[cond.type];
  if (!def) return;

  const row = document.createElement('div');
  row.className = 'condition-row' + (cond.enabled === false ? ' disabled' : '');
  row.dataset.id = cond.id;

  // Header
  const header = document.createElement('div');
  header.className = 'cond-header';

  const catLabel = document.createElement('span');
  catLabel.style.cssText = 'font-size:11px;color:#777;min-width:50px';
  catLabel.textContent = def.category;
  header.appendChild(catLabel);

  const typeLabel = document.createElement('span');
  typeLabel.style.fontWeight = '500';
  typeLabel.textContent = def.label;
  header.appendChild(typeLabel);

  const toggle = document.createElement('div');
  toggle.className = 'cond-toggle';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = cond.enabled !== false;
  chk.title = 'Enable/disable this condition';
  chk.addEventListener('change', () => {
    cond.enabled = chk.checked;
    row.classList.toggle('disabled', !chk.checked);
    onChange();
  });
  toggle.appendChild(chk);

  const del = document.createElement('button');
  del.className = 'cond-delete';
  del.textContent = '\u00d7';
  del.title = 'Remove condition';
  del.addEventListener('click', () => {
    row.remove();
    onDelete(cond.id);
  });
  toggle.appendChild(del);
  header.appendChild(toggle);
  row.appendChild(header);

  // Hint
  if (def.hint) {
    const hint = document.createElement('div');
    hint.className = 'cond-hint';
    hint.textContent = def.hint;
    row.appendChild(hint);
  }

  // Fields
  if (def.fields.length > 0) {
    const fields = document.createElement('div');
    fields.className = 'cond-fields';

    for (const f of def.fields) {
      const wrapper = document.createElement('div');

      const label = document.createElement('div');
      label.className = 'field-label';
      label.textContent = f.label;
      wrapper.appendChild(label);

      if (f.type === 'select') {
        const sel = document.createElement('select');
        for (const opt of f.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          sel.appendChild(o);
        }
        sel.value = cond[f.key] || (f.options[0] && f.options[0].value) || '';
        sel.addEventListener('change', () => {
          cond[f.key] = sel.value;
          onChange();
          // Re-render if IdP provider changes to show preset domains
          if (f.key === 'provider') updateIdpHint(row, cond);
        });
        wrapper.appendChild(sel);
      } else if (f.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.placeholder = f.placeholder || '';
        const val = cond[f.key];
        ta.value = Array.isArray(val) ? val.join('\n') : (val || '');
        ta.addEventListener('input', () => {
          cond[f.key] = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
          onChange();
        });
        wrapper.appendChild(ta);
      } else if (f.type === 'proxyChain') {
        if (!Array.isArray(cond[f.key])) {
          cond[f.key] = [{ type: 'PROXY', host: '', port: '8080' }];
        }
        wrapper.appendChild(renderProxyChainField(cond[f.key], onChange));
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = f.placeholder || '';
        inp.value = cond[f.key] || '';
        inp.addEventListener('input', () => {
          cond[f.key] = inp.value;
          onChange();
        });
        wrapper.appendChild(inp);
      }

      fields.appendChild(wrapper);
    }

    row.appendChild(fields);

    // Show preset IdP domains
    if (cond.type === 'idpBypass') {
      updateIdpHint(row, cond);
    }
  }

  container.appendChild(row);
}

const PROXY_TYPES = ['PROXY', 'HTTPS', 'SOCKS', 'SOCKS4', 'SOCKS5', 'DIRECT'];

function renderProxyChainField(entries, onChange) {
  const container = document.createElement('div');
  container.className = 'proxy-chain';

  function buildRow(entry, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'proxy-chain-entry';

    // Top row: optional fallback label + type select + optional remove button
    const topRow = document.createElement('div');
    topRow.className = 'proxy-chain-top-row';

    if (idx > 0) {
      const lbl = document.createElement('span');
      lbl.className = 'proxy-chain-fallback-label';
      lbl.textContent = 'fallback:';
      topRow.appendChild(lbl);
    }

    const typeSel = document.createElement('select');
    for (const pt of PROXY_TYPES) {
      const o = document.createElement('option');
      o.value = pt;
      o.textContent = pt;
      typeSel.appendChild(o);
    }
    typeSel.value = entry.type || 'PROXY';
    topRow.appendChild(typeSel);

    if (entries.length > 1) {
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'rm-btn';
      rmBtn.textContent = '\u00d7';
      rmBtn.title = 'Remove this proxy';
      rmBtn.addEventListener('click', () => {
        entries.splice(idx, 1);
        rebuild();
        onChange();
      });
      topRow.appendChild(rmBtn);
    }

    wrapper.appendChild(topRow);

    // Host + port row (hidden when DIRECT)
    const hostPortRow = document.createElement('div');
    hostPortRow.className = 'proxy-chain-host-row';

    const hostInput = document.createElement('input');
    hostInput.type = 'text';
    hostInput.placeholder = 'proxy.example.com';
    hostInput.value = entry.host || '';
    hostInput.addEventListener('input', () => { entry.host = hostInput.value; onChange(); });
    hostPortRow.appendChild(hostInput);

    const portInput = document.createElement('input');
    portInput.type = 'text';
    portInput.placeholder = '8080';
    portInput.value = entry.port || '';
    portInput.className = 'proxy-chain-port';
    portInput.addEventListener('input', () => { entry.port = portInput.value; onChange(); });
    hostPortRow.appendChild(portInput);

    wrapper.appendChild(hostPortRow);

    function syncDirectVisibility() {
      hostPortRow.style.display = typeSel.value === 'DIRECT' ? 'none' : '';
    }
    typeSel.addEventListener('change', () => {
      entry.type = typeSel.value;
      syncDirectVisibility();
      onChange();
    });
    syncDirectVisibility();

    return wrapper;
  }

  function rebuild() {
    container.innerHTML = '';
    for (let i = 0; i < entries.length; i++) {
      container.appendChild(buildRow(entries[i], i));
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-proxy-chain';
    addBtn.textContent = '+ Add failover proxy';
    addBtn.addEventListener('click', () => {
      entries.push({ type: 'PROXY', host: '', port: '8080' });
      rebuild();
      onChange();
    });
    container.appendChild(addBtn);
  }

  rebuild();
  return container;
}

function updateIdpHint(row, cond) {
  let existing = row.querySelector('.idp-preset-hint');
  if (existing) existing.remove();

  const provider = cond.provider;
  const domains = IDP_DOMAINS[provider];
  if (domains) {
    const hint = document.createElement('div');
    hint.className = 'cond-hint idp-preset-hint';
    hint.style.marginTop = '4px';
    hint.textContent = 'Pre-configured: ' + domains.join(', ');
    row.querySelector('.cond-fields').appendChild(hint);
  }
}

export function renderAddConditionDropdown(container, onAdd) {
  const wrapper = document.createElement('div');
  wrapper.className = 'builder-actions';

  const catSel = document.createElement('select');
  catSel.innerHTML = '<option value="">-- Category --</option>';
  for (const cat of CATEGORIES) {
    const o = document.createElement('option');
    o.value = cat;
    o.textContent = cat;
    catSel.appendChild(o);
  }

  const typeSel = document.createElement('select');
  typeSel.innerHTML = '<option value="">-- Condition --</option>';
  typeSel.disabled = true;

  catSel.addEventListener('change', () => {
    typeSel.innerHTML = '<option value="">-- Condition --</option>';
    typeSel.disabled = !catSel.value;
    if (catSel.value) {
      for (const [key, def] of Object.entries(CONDITION_DEFS)) {
        if (def.category === catSel.value) {
          const o = document.createElement('option');
          o.value = key;
          o.textContent = def.label;
          typeSel.appendChild(o);
        }
      }
    }
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn primary';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', () => {
    if (typeSel.value) {
      onAdd(typeSel.value);
      catSel.value = '';
      typeSel.innerHTML = '<option value="">-- Condition --</option>';
      typeSel.disabled = true;
    }
  });

  wrapper.appendChild(catSel);
  wrapper.appendChild(typeSel);
  wrapper.appendChild(addBtn);
  container.appendChild(wrapper);
}
