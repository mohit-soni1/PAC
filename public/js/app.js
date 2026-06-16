// Main application controller
// Tab switching, output panel, copy/download, status bar

import { generatePAC } from './pac-engine.js';
import { validateConfig, validatePAC } from './pac-validator.js';
import { createCondition, renderConditionRow, renderAddConditionDropdown, getConditionDefs } from './builder.js';
import { initAssistant } from './assistant.js';

let config = {
  defaults: {
    proxyHost: '',
    proxyPort: '8080',
    proxyType: 'PROXY',
    failoverProxies: [],
    includeDirectFallback: true,
  },
  conditions: [],
};

let generatedPAC = '';

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSidebar();
  initBuilder();
  initAssistantPanel();
  initOutputTabs();
  initResizer();
  updateStatus();
});

// --- Tab switching ---
function initTabs() {
  for (const tab of $$('.tab[data-target]')) {
    tab.addEventListener('click', () => {
      const target = tab.dataset.target;
      const group = tab.closest('.tabs').dataset.group;

      // Deactivate tabs in same group
      for (const t of tab.closest('.tabs').querySelectorAll('.tab')) t.classList.remove('active');
      tab.classList.add('active');

      // Show/hide panels
      const parent = tab.closest('.tabs').parentElement;
      for (const p of parent.querySelectorAll(`.panel[data-group="${group}"]`)) {
        p.classList.toggle('active', p.dataset.panel === target);
      }
    });
  }
}

// --- Sidebar proxy config ---
function initSidebar() {
  const proxyType = $('#proxy-type');
  const proxyHost = $('#proxy-host');
  const proxyPort = $('#proxy-port');
  const directFallback = $('#direct-fallback');
  const failoverContainer = $('#failover-list');
  const addFailoverBtn = $('#add-failover');

  const syncDefaults = () => {
    config.defaults.proxyType = proxyType.value;
    config.defaults.proxyHost = proxyHost.value;
    config.defaults.proxyPort = proxyPort.value;
    config.defaults.includeDirectFallback = directFallback.checked;
    updateStatus();
  };

  proxyType.addEventListener('change', syncDefaults);
  proxyHost.addEventListener('input', syncDefaults);
  proxyPort.addEventListener('input', syncDefaults);
  directFallback.addEventListener('change', syncDefaults);

  addFailoverBtn.addEventListener('click', () => {
    const entry = { host: '', port: '8080', type: config.defaults.proxyType };
    config.defaults.failoverProxies.push(entry);
    renderFailoverEntry(entry, failoverContainer, syncDefaults);
  });

  // Quick-add buttons
  for (const btn of $$('.quick-btn')) {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      addCondition(type);
    });
  }
}

const FAILOVER_PROXY_TYPES = ['PROXY', 'HTTPS', 'SOCKS', 'SOCKS4', 'SOCKS5', 'DIRECT'];

function renderFailoverEntry(entry, container, onChange) {
  const div = document.createElement('div');
  div.className = 'failover-entry';

  // Header row: label + remove button
  const header = document.createElement('div');
  header.className = 'failover-entry-header';

  const lbl = document.createElement('span');
  lbl.className = 'failover-entry-label';
  lbl.textContent = 'Failover proxy';
  header.appendChild(lbl);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rm-btn';
  rmBtn.textContent = '\u00d7';
  rmBtn.title = 'Remove failover';
  rmBtn.addEventListener('click', () => {
    const idx = config.defaults.failoverProxies.indexOf(entry);
    if (idx >= 0) config.defaults.failoverProxies.splice(idx, 1);
    div.remove();
    onChange();
  });
  header.appendChild(rmBtn);
  div.appendChild(header);

  // Type select — full-width row
  const typeSel = document.createElement('select');
  for (const pt of FAILOVER_PROXY_TYPES) {
    const o = document.createElement('option');
    o.value = pt;
    o.textContent = pt;
    typeSel.appendChild(o);
  }
  typeSel.value = entry.type || 'PROXY';
  div.appendChild(typeSel);

  // Host + port row (hidden when DIRECT)
  const hostRow = document.createElement('div');
  hostRow.className = 'failover-host-row';

  const hostInput = document.createElement('input');
  hostInput.type = 'text';
  hostInput.className = 'failover-host';
  hostInput.placeholder = 'proxy.example.com';
  hostInput.value = entry.host;
  hostInput.addEventListener('input', () => { entry.host = hostInput.value; onChange(); });
  hostRow.appendChild(hostInput);

  const portInput = document.createElement('input');
  portInput.type = 'text';
  portInput.className = 'failover-port';
  portInput.placeholder = '8080';
  portInput.value = entry.port;
  portInput.addEventListener('input', () => { entry.port = portInput.value; onChange(); });
  hostRow.appendChild(portInput);

  div.appendChild(hostRow);

  function syncDirectVisibility() {
    hostRow.style.display = typeSel.value === 'DIRECT' ? 'none' : '';
  }
  typeSel.addEventListener('change', () => {
    entry.type = typeSel.value;
    syncDirectVisibility();
    onChange();
  });
  syncDirectVisibility();

  container.appendChild(div);
}

// --- Builder ---
function initBuilder() {
  const list = $('#condition-list');
  const addArea = $('#add-condition-area');
  const genBtn = $('#generate-btn');

  renderAddConditionDropdown(addArea, (type) => addCondition(type));

  genBtn.addEventListener('click', () => doGenerate());
}

function addCondition(type) {
  const cond = createCondition(type);
  if (!cond) return;

  // Check for duplicate single-instance types
  const singleTypes = ['plainHostname', 'privateIpBypass', 'localDomain', 'protocolBypass',
    'presetOsUpdates', 'presetCrl', 'presetM365', 'presetConferencing'];
  if (singleTypes.includes(type) && config.conditions.some(c => c.type === type)) {
    return; // Already exists
  }

  config.conditions.push(cond);
  renderConditionRow(cond, $('#condition-list'), () => updateStatus(), (id) => {
    config.conditions = config.conditions.filter(c => c.id !== id);
    updateStatus();
  });
  updateStatus();
}

// --- Assistant ---
function initAssistantPanel() {
  initAssistant($('#assistant-panel'), (parsedConfig) => {
    // Load into builder
    config = parsedConfig;
    syncSidebarFromConfig();
    rerenderConditions();
    // Switch to builder tab
    const builderTab = $('[data-target="builder"]');
    if (builderTab) builderTab.click();
  }, (parsedConfig) => {
    // Generate directly
    config = parsedConfig;
    syncSidebarFromConfig();
    rerenderConditions();
    doGenerate();
  });
}

function syncSidebarFromConfig() {
  $('#proxy-type').value = config.defaults.proxyType || 'PROXY';
  $('#proxy-host').value = config.defaults.proxyHost || '';
  $('#proxy-port').value = config.defaults.proxyPort || '8080';
  $('#direct-fallback').checked = config.defaults.includeDirectFallback !== false;

  const failoverContainer = $('#failover-list');
  failoverContainer.innerHTML = '';
  for (const fp of config.defaults.failoverProxies || []) {
    renderFailoverEntry(fp, failoverContainer, () => updateStatus());
  }
}

function rerenderConditions() {
  const list = $('#condition-list');
  list.innerHTML = '';
  for (const cond of config.conditions) {
    renderConditionRow(cond, list, () => updateStatus(), (id) => {
      config.conditions = config.conditions.filter(c => c.id !== id);
      updateStatus();
    });
  }
  updateStatus();
}

// --- Generation ---
function doGenerate() {
  // Validate config first
  const configErrors = validateConfig(config);
  const errors = configErrors.filter(r => r.severity === 'error');

  if (errors.length > 0) {
    showValidation(configErrors);
    // Switch to validation tab
    const valTab = $('[data-target="validation"]');
    if (valTab) valTab.click();
    updateStatus(configErrors);
    return;
  }

  // Generate
  try {
    generatedPAC = generatePAC(config);
  } catch (err) {
    showValidation([{ severity: 'error', message: `Generation error: ${err.message}` }]);
    updateStatus([{ severity: 'error' }]);
    return;
  }

  // Validate output
  const pacResults = validatePAC(generatedPAC);
  const allResults = [...configErrors, ...pacResults];

  showCode(generatedPAC);
  showValidation(allResults);
  updateStatus(allResults);

  // Switch to code tab
  const codeTab = $('[data-target="code"]');
  if (codeTab) codeTab.click();
}

// --- Output ---
function initOutputTabs() {
  $('#copy-btn').addEventListener('click', () => {
    if (!generatedPAC) return;
    navigator.clipboard.writeText(generatedPAC).then(() => {
      const toast = $('#copy-toast');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1500);
    });
  });

  $('#download-pac').addEventListener('click', () => downloadFile('proxy.pac'));
  $('#download-wpad').addEventListener('click', () => downloadFile('wpad.dat'));
}

function downloadFile(filename) {
  if (!generatedPAC) return;
  const blob = new Blob([generatedPAC], { type: 'application/x-ns-proxy-autoconfig' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showCode(code) {
  const container = $('#code-container');
  container.innerHTML = '';

  const pre = document.createElement('pre');
  const lines = code.split('\n');

  for (const line of lines) {
    const span = document.createElement('span');
    span.className = 'code-line';
    span.innerHTML = highlightSyntax(escapeHtml(line));
    pre.appendChild(span);
  }

  container.appendChild(pre);
}

function highlightSyntax(line) {
  // Comments
  if (/^\s*\/[\/*]/.test(line) || /^\s*\*/.test(line)) {
    return `<span class="hl-cmt">${line}</span>`;
  }

  return line
    // Inline comments
    .replace(/(\/\/.*)$/, '<span class="hl-cmt">$1</span>')
    .replace(/(\/\*.*?\*\/)/, '<span class="hl-cmt">$1</span>')
    // Strings
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="hl-str">$1</span>')
    // Keywords
    .replace(/\b(function|var|if|else|return)\b/g, '<span class="hl-kw">$1</span>')
    // PAC functions
    .replace(/\b(isPlainHostName|dnsDomainIs|localHostOrDomainIs|shExpMatch|dnsResolve|isInNet|myIpAddress|isResolvable|weekdayRange|dateRange|timeRange|dnsDomainLevels|convert_addr|alert)\b/g, '<span class="hl-fn">$1</span>')
    // Numbers
    .replace(/\b(\d+)\b/g, '<span class="hl-num">$1</span>');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showValidation(results) {
  const container = $('#validation-container');
  container.innerHTML = '';

  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state">No validation results yet</div>';
    return;
  }

  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'val-item';

    const icon = document.createElement('span');
    icon.className = 'val-icon ' + r.severity;
    icon.textContent = r.severity === 'error' ? '\u25cf' : r.severity === 'warning' ? '\u25b2' : '\u2713';

    const msg = document.createElement('span');
    msg.className = 'val-msg';
    msg.textContent = r.message;

    div.appendChild(icon);
    div.appendChild(msg);
    container.appendChild(div);
  }
}

// --- Resizer ---
function initResizer() {
  const resizer = $('#resize-bar');
  const inputPanel = $('#input-wrapper');
  const outputPanel = $('#output-wrapper');
  let startY, startInputH;

  resizer.addEventListener('mousedown', (e) => {
    startY = e.clientY;
    startInputH = inputPanel.offsetHeight;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    const diff = e.clientY - startY;
    const newH = Math.max(120, startInputH + diff);
    inputPanel.style.flex = 'none';
    inputPanel.style.height = newH + 'px';
    outputPanel.style.flex = '1';
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

// --- Status bar ---
function updateStatus(validationResults) {
  const activeCount = config.conditions.filter(c => c.enabled !== false).length;
  const lineCount = generatedPAC ? generatedPAC.split('\n').length : 0;

  $('#status-conditions').textContent = `${activeCount} condition${activeCount !== 1 ? 's' : ''}`;
  $('#status-lines').textContent = lineCount > 0 ? `${lineCount} lines` : 'not generated';

  const errorEl = $('#status-errors');
  if (validationResults) {
    const errors = validationResults.filter(r => r.severity === 'error').length;
    const warnings = validationResults.filter(r => r.severity === 'warning').length;
    if (errors > 0) {
      errorEl.className = 'status-item status-error';
      errorEl.textContent = `${errors} error${errors !== 1 ? 's' : ''}`;
    } else if (warnings > 0) {
      errorEl.className = 'status-item status-warn';
      errorEl.textContent = `${warnings} warning${warnings !== 1 ? 's' : ''}`;
    } else {
      errorEl.className = 'status-item status-ok';
      errorEl.textContent = 'valid';
    }
  } else {
    errorEl.className = 'status-item';
    errorEl.textContent = '';
  }
}
