// ═══════════════════════════════════════════════
// USCIS Command Center — Frontend
// ═══════════════════════════════════════════════

let authToken = localStorage.getItem('uscis_token');
let batchChartInstance = null;

// ─── Globals ────────────────────
const $ = id => document.getElementById(id);
let cases = [];
let settings = {};
let selectedCaseId = null;
let currentFilter = 'all';
let searchQuery = '';

const NEIGHBOR_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`;

const STAGES = ['Received', 'Biometrics', 'Review', 'Approved', 'Card', 'Mailed', 'Done'];

// ─── Three.js Fluid Data Wave ────────────
(function initThreeJS() {
  const canvas = document.getElementById('three-canvas');
  if (!canvas || !window.THREE) return;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030712, 0.008); // Sophisticated deep fade

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.set(0, 30, 80);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // The Wave Geometry
  const width = 120;
  const depth = 120;
  const spacing = 2.5;
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  
  for (let ix = 0; ix < width; ix++) {
    for (let iz = 0; iz < depth; iz++) {
      const x = (ix - width / 2) * spacing;
      const z = (iz - depth / 2) * spacing;
      // y is calculated in animate
      positions.push(x, 0, z);
    }
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  // Sophisticated minimal material (icy white/blue dots)
  const material = new THREE.PointsMaterial({
    color: 0x94a3b8, // Slate gray 400
    size: 0.25,
    transparent: true,
    opacity: 0.6,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // Smooth Parallax
  let mouseX = 0;
  let mouseY = 0;
  let count = 0;
  const windowHalfX = window.innerWidth / 2;
  const windowHalfY = window.innerHeight / 2;

  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX - windowHalfX) * 0.05;
    mouseY = (e.clientY - windowHalfY) * 0.05;
  });

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  function animate() {
    requestAnimationFrame(animate);

    // Smooth subtle camera drift
    camera.position.x += (mouseX - camera.position.x) * 0.02;
    camera.position.y += (30 - mouseY - camera.position.y) * 0.02;
    camera.lookAt(scene.position);

    // Animate wave math
    const positions = particles.geometry.attributes.position.array;
    let i = 0;
    for (let ix = 0; ix < width; ix++) {
      for (let iz = 0; iz < depth; iz++) {
        // Complex fluid sine wave math
        positions[i + 1] = 
          (Math.sin((ix + count) * 0.3) * 5) +
          (Math.sin((iz + count) * 0.5) * 5);
        i += 3;
      }
    }
    particles.geometry.attributes.position.needsUpdate = true;
    count += 0.025; // elegant slow speed

    renderer.render(scene, camera);
  }

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animate();
  } else {
    renderer.render(scene, camera);
  }
})();

// ─── Cursor Spotlight ────────
document.addEventListener('mousemove', (e) => {
  document.documentElement.style.setProperty('--mouse-x', e.clientX + 'px');
  document.documentElement.style.setProperty('--mouse-y', e.clientY + 'px');
});

// ─── Toasts ──────────────
window.showToast = function(message) {
  const container = $('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 3500);
};

// ─── Authentication ──────────────
document.addEventListener('DOMContentLoaded', authenticateAndStart);

function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function doLogin() {
  const pwd = $('input-password').value;
  if (!pwd) return showLoginError('Enter a password');
  $('login-error').classList.add('hidden');

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (!res.ok) return showLoginError(data.error || 'Login failed');

    authToken = pwd;
    localStorage.setItem('uscis_token', authToken);
    $('overlay-login').classList.add('hidden');
    $('app-canvas').style.display = 'flex';
    init();
  } catch {
    showLoginError('Connection error');
  }
}

async function doRegister() {
  const pwd = $('input-password').value;
  if (!pwd) return showLoginError('Enter a password');
  if (pwd.length < 4) return showLoginError('Password must be at least 4 characters');
  $('login-error').classList.add('hidden');

  try {
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (!res.ok) return showLoginError(data.error || 'Registration failed');

    authToken = pwd;
    localStorage.setItem('uscis_token', authToken);
    $('overlay-login').classList.add('hidden');
    $('app-canvas').style.display = 'flex';
    init();
  } catch {
    showLoginError('Connection error');
  }
}

async function authenticateAndStart() {
  // Always dark theme
  document.documentElement.setAttribute('data-theme', 'dark');

  // Always wire up login handlers
  $('btn-login').onclick = doLogin;
  $('btn-register').onclick = doRegister;
  $('input-password').addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
  });

  if (authToken) {
    // Verify token still valid
    try {
      const res = await fetch('/api/cases', { headers: { 'Authorization': authToken } });
      if (res.ok) {
        $('overlay-login').classList.add('hidden');
        $('app-canvas').style.display = 'flex';
        init();
        return;
      }
    } catch {}
    // Token invalid — clear and show login
    localStorage.removeItem('uscis_token');
    authToken = null;
  }

  $('overlay-login').classList.remove('hidden');
  $('app-canvas').style.display = 'none';
}

// ─── API Subsystem ───────────────
const API = {
  async _handle(res) {
    if (res.status === 401) {
      localStorage.removeItem('uscis_token'); authToken = null;
      $('login-error').textContent = 'Session expired. Please sign in again.';
      $('login-error').classList.remove('hidden');
      $('overlay-login').classList.remove('hidden');
      $('app-canvas').style.display = 'none';
      $('cases-grid').innerHTML = '';
      throw new Error('Unauthorized');
    }
    return await res.json();
  },
  async get(url) { const r = await fetch(url, { headers: { 'Authorization': authToken }}); return this._handle(r); },
  async post(url, body) { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Authorization':authToken}, body:JSON.stringify(body||{}) }); return this._handle(r); },
  async put(url, body) { const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json','Authorization':authToken}, body:JSON.stringify(body||{}) }); return this._handle(r); },
  async del(url) { const r = await fetch(url, { method: 'DELETE', headers: { 'Authorization': authToken }}); return this._handle(r); },
  async postStream(url, onChunk) {
    const res = await fetch(url, { method: 'POST', headers: { 'Authorization': authToken }});
    if (res.status === 401) return this._handle(res);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Stream error'); }
    if (res.headers.get('content-type')?.includes('application/json')) return await res.json();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) { try { onChunk(JSON.parse(line)); } catch (e) {} }
      }
    }
    if (buffer.trim()) try { onChunk(JSON.parse(buffer)); } catch (e) {}
    return { streamComplete: true };
  }
};

// ─── Init ────────────────────
async function init() {
  await refresh();
  bindEvents();
}

async function refresh() {
  cases = await API.get('/api/cases');
  settings = await API.get('/api/settings');
  try {
    const status = await API.get('/api/status');
    const fTime = (dStr) => dStr ? new Date(dStr).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--';
    $('status-last').textContent = fTime(status.lastCheckTime);
    $('status-next').textContent = status.cronActive ? fTime(status.nextCheckTime) : 'Off';
    const dot = $('sync-dot');
    const label = $('sync-label');
    if (status.cronActive) {
      dot.classList.add('active');
      label.textContent = 'Auto-sync active';
    } else {
      dot.classList.remove('active');
      label.textContent = 'Auto-sync off';
    }
  } catch(e) {}
  renderCases();
}

// ─── Modal Management ───────────
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

// ─── Progress & Analytics ───────

function getProgressInfo(status, detail) {
  if (!status) return { stage: 'Pending', percent: 5, stageIndex: -1 };
  const s = (status + ' ' + (detail || '')).toLowerCase();

  // ── Terminal: Denied / Rejected / Withdrawn / Revoked ──
  if (s.includes('denied') || s.includes('rejected') || s.includes('revoked')
    || s.includes('terminated') || s.includes('withdrawn') || s.includes('abandoned'))
    return { stage: 'Denied', percent: 100, stageIndex: -2 };

  // ── Stage 6: Delivered / Complete ──
  if (s.includes('delivered') || s.includes('picked up from post office')
    || s.includes('picked up by the united states postal service')
    || s.includes('was picked up'))
    return { stage: 'Delivered', percent: 100, stageIndex: 6 };

  // ── Stage 5: Mailed ──
  if (s.includes('mailed to you') || s.includes('was mailed')
    || s.includes('usps tracking') || s.includes('in transit'))
    return { stage: 'Mailed', percent: 92, stageIndex: 5 };

  // ── Stage 4: Card / Document Production ──
  if (s.includes('new card is being produced') || s.includes('card is being produced')
    || s.includes('card was produced') || s.includes('ordered your new card')
    || s.includes('document was produced') || s.includes('being produced')
    || s.includes('post-decision activity'))
    return { stage: 'Card Produced', percent: 82, stageIndex: 4 };

  // ── Stage 3: Approved ──
  if (s.includes('approved') || s.includes('granted'))
    return { stage: 'Approved', percent: 72, stageIndex: 3 };

  // ── Stage 2: Active Processing (many sub-stages) ──

  // Interview completed
  if (s.includes('interview was completed') || s.includes('interview was scheduled and completed'))
    return { stage: 'Interview Done', percent: 62, stageIndex: 2 };

  // Interview upcoming or in progress
  if (s.includes('interview is scheduled') || s.includes('interview was scheduled')
    || s.includes('interview date'))
    return { stage: 'Interview Scheduled', percent: 55, stageIndex: 2 };

  // Decision pending (post-interview or post-review)
  if (s.includes('decision') && !s.includes('post-decision'))
    return { stage: 'Decision Pending', percent: 60, stageIndex: 2 };

  // RFE response received
  if ((s.includes('response') && s.includes('received')) || s.includes('rfe response received'))
    return { stage: 'RFE Response Received', percent: 50, stageIndex: 2 };

  // RFE / NOID issued
  if (s.includes('request for evidence') || s.includes('request for additional evidence')
    || s.includes('request for initial evidence') || s.includes('rfe')
    || s.includes('intent to deny') || s.includes('notice of intent'))
    return { stage: 'RFE Issued', percent: 40, stageIndex: 2 };

  // Actively being reviewed
  if (s.includes('actively review') || s.includes('is being actively reviewed')
    || s.includes('initial review'))
    return { stage: 'Under Review', percent: 45, stageIndex: 2 };

  // Case transferred
  if (s.includes('transferred') || s.includes('transfer'))
    return { stage: 'Transferred', percent: 42, stageIndex: 2 };

  // Case updated / general review
  if (s.includes('updated to show') || s.includes('was updated')
    || s.includes('case status was updated'))
    return { stage: 'Updated', percent: 40, stageIndex: 2 };

  // Expedite requested
  if (s.includes('expedite'))
    return { stage: 'Expedite', percent: 42, stageIndex: 2 };

  // ── Stage 1: Biometrics / Initial Processing ──
  if (s.includes('fingerprint') || s.includes('biometric')
    || s.includes('biometrics appointment') || s.includes('acs'))
    return { stage: 'Biometrics', percent: 25, stageIndex: 1 };

  // Fee waived or paid
  if (s.includes('fee was waived') || s.includes('fee was paid'))
    return { stage: 'Fee Processed', percent: 18, stageIndex: 1 };

  // ── Stage 0: Case Received / Filed ──
  if (s.includes('was received') || s.includes('accepted')
    || s.includes('receipt notice') || s.includes('case was received')
    || s.includes('receipt was sent'))
    return { stage: 'Received', percent: 15, stageIndex: 0 };

  // ── Catch-all: if nothing matched ──
  // Check the detail text for any clues
  if (s.includes('case status online'))
    return { stage: 'Processing', percent: 30, stageIndex: 1 };

  return { stage: 'Processing', percent: 30, stageIndex: 1 };
}

function getServiceCenter(receiptNumber) {
  const prefix = (receiptNumber || '').substring(0, 3).toUpperCase();
  const centers = {
    'IOE': { code: 'IOE', name: 'Electronic Processing', city: 'Online', color: 'var(--cyan)' },
    'LIN': { code: 'LIN', name: 'Nebraska Service Center', city: 'Lincoln, NE', color: 'var(--blue)' },
    'SRC': { code: 'SRC', name: 'Texas Service Center', city: 'Dallas, TX', color: 'var(--amber)' },
    'EAC': { code: 'EAC', name: 'Vermont Service Center', city: 'St. Albans, VT', color: 'var(--lime)' },
    'WAC': { code: 'WAC', name: 'California Service Center', city: 'Laguna Niguel, CA', color: 'var(--pink)' },
    'MSC': { code: 'MSC', name: 'National Benefits Center', city: "Lee's Summit, MO", color: 'var(--cyan)' },
    'NBC': { code: 'NBC', name: 'National Benefits Center', city: "Lee's Summit, MO", color: 'var(--cyan)' },
    'YSC': { code: 'YSC', name: 'Potomac Service Center', city: 'Arlington, VA', color: 'var(--purple)' },
  };
  return centers[prefix] || { code: prefix, name: 'Service Center', city: prefix, color: 'var(--text-muted)' };
}

function renderProgressStepper(stageIndex) {
  const isDenied = stageIndex === -2;
  if (isDenied) {
    return `<div class="progress-stepper denied"><div class="step-denied-bar"></div><span>Case Denied</span></div>`;
  }
  let html = '<div class="progress-stepper">';
  STAGES.forEach((stage, i) => {
    const isCompleted = stageIndex >= 0 && i < stageIndex;
    const isActive = i === stageIndex;
    const cls = isActive ? 'active' : (isCompleted ? 'completed' : '');
    if (i > 0) html += `<div class="step-line ${isCompleted || isActive ? 'completed' : ''}"></div>`;
    html += `<div class="step ${cls}"><div class="step-dot"></div><div class="step-label">${stage}</div></div>`;
  });
  html += '</div>';
  return html;
}

// ─── Animated Counter ───
function animateCounter(el, target) {
  const duration = 700;
  const start = performance.now();
  const from = parseInt(el.textContent) || 0;
  if (from === target) { el.textContent = target; return; }
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (target - from) * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animateValue(obj, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 4);
    obj.innerHTML = Math.floor(ease * (end - start) + start) + "%";
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

// ─── 3D Card Hover + Glow Tracking ───
function attachHoverEffects() {
  const cards = document.querySelectorAll('.hover-card');
  for (const card of cards) {
    const content = card.querySelector('.card-content');
    if (!content) continue;
    card.onmousemove = e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateY = ((x - centerX) / centerX) * 6;
      const rotateX = ((centerY - y) / centerY) * 6;
      content.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(4px)`;
      content.style.setProperty('--card-glow-x', x + 'px');
      content.style.setProperty('--card-glow-y', y + 'px');
    };
    card.onmouseleave = () => { content.style.transform = ''; };
  }
}

// ─── Scroll Reveal ───
let scrollObserver = null;
function setupScrollReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.hover-card').forEach(c => c.classList.add('visible'));
    return;
  }
  if (scrollObserver) scrollObserver.disconnect();
  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        scrollObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '40px' });
  document.querySelectorAll('.hover-card:not(.visible)').forEach(card => scrollObserver.observe(card));
}

// ─── Event Bindings ───────────
function bindEvents() {
  $('btn-add-case').onclick = () => openModal('overlay-add');
  $('btn-settings').onclick = () => { applySettings(); openModal('overlay-settings'); };
  $('btn-logs').onclick = () => { refreshLogs(); openModal('overlay-logs'); };
  $('btn-check-all').onclick = checkAll;
  $('btn-logout').onclick = () => {
    localStorage.removeItem('uscis_token');
    authToken = null;
    $('app-canvas').style.display = 'none';
    $('cases-grid').innerHTML = '';
    $('input-password').value = '';
    $('login-error').classList.add('hidden');
    $('overlay-login').classList.remove('hidden');
  };
  $('btn-timeline').onclick = renderTimeline;
  $('btn-compare').onclick = renderComparison;

  // Close modals
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll('.overlay').forEach(overlay => {
    if (overlay.id === 'overlay-login' || overlay.id === 'overlay-loading') return;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Add case form
  $('btn-add-submit').onclick = addCase;
  $('input-receipt').addEventListener('keydown', e => { if (e.key === 'Enter') addCase(); });

  // Detail
  $('detail-delete').onclick = promptDeleteCase;
  $('btn-cancel-del').onclick = () => closeModal('overlay-confirm');
  $('btn-confirm-del').onclick = executeDeleteCase;
  $('btn-check-neighbors').onclick = () => {
    const activeCase = cases.find(c => c.id === selectedCaseId);
    if (activeCase) checkBatchNeighbors(activeCase.receiptNumber);
  };

  // Settings
  $('setting-autocheck').addEventListener('change', async (e) => {
    await API.put('/api/settings', { autoCheckEnabled: e.target.checked });
    await refresh(); showToast('Saved');
  });
  $('setting-interval').addEventListener('change', async (e) => {
    let val = parseInt(e.target.value);
    if (val < 1) val = 1; if (val > 24) val = 24;
    await API.put('/api/settings', { checkIntervalHours: val });
    await refresh(); showToast('Interval updated');
  });
  $('setting-notifications').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await API.put('/api/settings', { notificationsEnabled: enabled });
    showToast('Notifications ' + (enabled ? 'enabled' : 'disabled'));
    if (enabled) subscribeToPush();
  });
  $('btn-test-notif').onclick = async () => {
    showToast('Sending test notification...');
    await API.post('/api/test-notification');
  };

  // Share toggle
  $('setting-share').addEventListener('change', async () => {
    try {
      const res = await API.post('/api/share');
      $('setting-share').checked = res.enabled;
      if (res.enabled && res.token) {
        $('share-link-input').value = location.origin + '/s/' + res.token;
        $('share-link-row').classList.remove('hidden');
        showToast('Share link created');
      } else {
        $('share-link-row').classList.add('hidden');
        showToast('Sharing disabled');
      }
    } catch { showToast('Failed to update sharing'); }
  });
  $('btn-copy-share').onclick = () => {
    const input = $('share-link-input');
    navigator.clipboard.writeText(input.value).then(() => showToast('Link copied'));
  };

  // Backup / Restore
  $('btn-backup-data').onclick = () => {
    const backup = JSON.stringify({ cases, settings }, null, 2);
    const blob = new Blob([backup], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `uscis-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  $('restore-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await API.post('/api/restore', payload);
      await refresh();
      showToast('Data restored from backup');
    } catch(err) {
      showToast('Invalid backup file');
    }
  });

  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderCases();
    };
  });

  // Search
  $('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderCases();
  });
}

// ─── Rendering ──────────────────
function renderCases() {
  const grid = $('cases-grid');
  const empty = $('empty-state');

  const totalVal = cases.length;
  const apprVal = cases.filter(c => {
    const t = getBadgeText(c.status);
    return t === 'APPROVED' || t === 'RECEIVED' || t === 'CARD COMING';
  }).length;
  const rfeVal = cases.filter(c => getBadgeText(c.status) === 'ACTION NEEDED').length;
  animateCounter($('metric-total'), totalVal);
  animateCounter($('metric-appr'), apprVal);
  animateCounter($('metric-rfe'), rfeVal);

  if (cases.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    $('dashboard-metrics').classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  $('dashboard-metrics').classList.remove('hidden');

  // Filter
  let filtered = cases;
  if (currentFilter !== 'all') {
    filtered = cases.filter(c => {
      const cat = getBadgeText(c.status);
      if (currentFilter === 'progress') return cat === 'IN PROGRESS' || cat === 'PENDING';
      if (currentFilter === 'approved') return cat === 'APPROVED' || cat === 'RECEIVED' || cat === 'CARD COMING';
      if (currentFilter === 'action') return cat === 'ACTION NEEDED';
      return true;
    });
  }
  if (searchQuery) {
    filtered = filtered.filter(c =>
      c.receiptNumber.toLowerCase().includes(searchQuery) ||
      (c.label && c.label.toLowerCase().includes(searchQuery)) ||
      (c.status && c.status.toLowerCase().includes(searchQuery))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px 0; color:var(--text-muted);">No cases match this filter.</div>`;
    return;
  }

  let delay = 0;
  grid.innerHTML = filtered.map(c => {
    const cat = getBadgeText(c.status);
    const progress = getProgressInfo(c.status, c.statusDetail);
    let badgeClass = 'b-neut';
    if (cat === 'APPROVED' || cat === 'RECEIVED' || cat === 'CARD COMING') badgeClass = 'b-appr';
    else if (cat === 'ACTION NEEDED') badgeClass = 'b-rfe';
    else if (cat === 'DENIED') badgeClass = 'b-denied';

    let dataStatus = 'progress';
    if (cat === 'APPROVED') dataStatus = 'approved';
    else if (cat === 'RECEIVED') dataStatus = 'received';
    else if (cat === 'ACTION NEEDED') dataStatus = 'action';
    else if (cat === 'DENIED') dataStatus = 'denied';
    else if (cat === 'CARD COMING') dataStatus = 'card';
    else if (cat === 'PENDING') dataStatus = 'pending';

    const styleStr = `animation-delay: ${delay}ms;`;
    if (delay < 600) delay += 60;

    return `
    <div class="hover-card" data-status="${dataStatus}" style="${styleStr}" onclick="showDetail('${c.id}')">
      <div class="card-content">
        <div class="c-head">
          <div>
            <div class="c-receipt">${c.receiptNumber}</div>
            ${c.label ? `<div class="c-alias">${esc(c.label)}</div>` : ''}
          </div>
          <span class="badge ${badgeClass}">${cat}</span>
        </div>
        <div class="c-status">${c.status ? esc(c.status) : 'Awaiting first check'}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
        <div class="progress-label"><span>${progress.stage}</span><span>${progress.percent}%</span></div>
        <div class="c-footer">
          <span class="c-time">Updated ${c.lastChanged ? timeAgo(c.lastChanged) : 'never'}</span>
          <div class="c-actions">
            <button class="btn-icon-sm" title="Refresh" onclick="event.stopPropagation(); window.checkSingle('${c.id}')">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  attachHoverEffects();
  setupScrollReveal();
}

// ─── Detail Display ──────
window.showDetail = function(id) {
  selectedCaseId = id;
  const c = cases.find(x => x.id === id);
  if (!c) return;

  $('detail-title').textContent = c.receiptNumber;
  const cat = getBadgeText(c.status);
  const progress = getProgressInfo(c.status, c.statusDetail);
  const center = getServiceCenter(c.receiptNumber);

  // Progress stepper
  $('detail-progress-stepper').innerHTML = renderProgressStepper(progress.stageIndex);

  // Badge
  const badge = $('detail-badge');
  badge.textContent = cat;
  badge.className = 'badge ' + (
    (cat === 'APPROVED' || cat === 'RECEIVED' || cat === 'CARD COMING') ? 'b-appr' :
    (cat === 'ACTION NEEDED' ? 'b-rfe' : (cat === 'DENIED' ? 'b-denied' : 'b-neut'))
  );
  $('detail-last-changed').textContent = c.lastChanged ? 'Changed ' + timeAgo(c.lastChanged) : 'No status changes yet.';

  // Service center
  $('detail-service-center').innerHTML = `
    <div class="service-center-badge mb-3">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <span>${center.name}</span>
      <span style="color:var(--text-muted)">·</span>
      <span style="color:var(--text-muted)">${center.city}</span>
    </div>`;

  // Processing estimate
  $('detail-estimate').classList.add('hidden');

  // Label
  $('detail-alias-input').value = c.label || '';
  $('btn-save-alias').onclick = async () => {
    const newAlias = $('detail-alias-input').value.trim();
    if (newAlias !== (c.label || '')) {
      await API.put(`/api/cases/${c.id}`, { label: newAlias });
      await refresh();
      showToast('Label updated');
    }
  };

  // Chart reset
  if (batchChartInstance) { batchChartInstance.destroy(); batchChartInstance = null; }
  $('chart-wrapper').classList.add('hidden');
  $('insight-readout').classList.add('hidden');
  $('btn-check-neighbors').innerHTML = `${NEIGHBOR_ICON} Scan Nearby (±10)`;

  // History timeline
  let hHtml = '';
  if (c.history && c.history.length > 0) {
    const rev = [...c.history].reverse();
    rev.forEach((h, i) => {
      const extClass = i === 0 ? 'latest' : '';
      hHtml += `<div class="tl-node ${extClass}">
        <div class="tl-title mb-1">${esc(h.status)}</div>
        <div class="tl-desc text-sm mb-1">${h.statusDetail ? esc(h.statusDetail) : ''}</div>
        <div class="tl-date">${new Date(h.checkedAt).toLocaleDateString()} at ${new Date(h.checkedAt).toLocaleTimeString()}</div>
      </div>`;
    });
  } else {
    hHtml = `<div style="color:var(--text-muted); font-size:13px;">No status history yet.</div>`;
  }
  $('detail-history-target').innerHTML = hHtml;

  openModal('overlay-detail');
};

// ─── Batch Scan ───
async function checkBatchNeighbors(receiptNumber) {
  const btn = $('btn-check-neighbors');
  btn.innerHTML = `${NEIGHBOR_ICON} Checking...`;
  btn.disabled = true;
  $('chart-wrapper').classList.add('hidden');
  $('insight-readout').classList.add('hidden');

  try {
    const res = await API.postStream(`/api/check-neighbors/${receiptNumber}`, (chunk) => {
      if (chunk.type === 'progress') {
        let p = Math.round((chunk.index / chunk.total) * 100);
        btn.innerHTML = `${NEIGHBOR_ICON} ${chunk.target} [${p}%]`;
      } else if (chunk.type === 'complete') {
        renderInsightsChart(chunk.results);
      } else if (chunk.type === 'error') { throw new Error(chunk.error); }
    });
    if (res && res.cached) renderInsightsChart(res.results);
  } catch (err) {
    showToast('Scan failed');
    btn.innerHTML = `${NEIGHBOR_ICON} Retry`;
    btn.disabled = false;
  }
}

function renderInsightsChart(results) {
  $('chart-wrapper').classList.remove('hidden');
  const btn = $('btn-check-neighbors');
  btn.innerHTML = `${NEIGHBOR_ICON} Run Again`;
  btn.disabled = false;

  const statusCounts = {}; let totalValid = 0;
  Object.values(results).forEach(s => {
    if (s === 'Error') return;
    const cat = getBadgeText(s);
    statusCounts[cat] = (statusCounts[cat] || 0) + 1;
    totalValid++;
  });

  const labels = Object.keys(statusCounts);
  const dataVals = Object.values(statusCounts);
  const colors = labels.map(l => {
    if (l === 'APPROVED' || l === 'RECEIVED') return '#a3ff12';
    if (l === 'ACTION NEEDED') return '#fbbf24';
    if (l === 'DENIED') return '#f43f5e';
    return 'rgba(0, 240, 255, 0.3)';
  });

  if (batchChartInstance) batchChartInstance.destroy();
  const ctx = document.getElementById('batchChart').getContext('2d');
  Chart.defaults.font.family = 'Inter, -apple-system, sans-serif';
  Chart.defaults.color = '#4a5568';

  batchChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: dataVals, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, pointStyle: 'circle' } } }, cutout: '78%' }
  });

  const appr = statusCounts['APPROVED'] || 0;
  const rate = totalValid > 0 ? Math.round((appr / totalValid) * 100) : 0;
  $('insight-readout').classList.remove('hidden');
  animateValue($('velocity-counter'), 0, rate, 1200);

  // Processing time estimate
  const inProgress = (statusCounts['IN PROGRESS'] || 0) + (statusCounts['PENDING'] || 0);
  const approved = appr;
  if (totalValid > 3) {
    const est = $('detail-estimate');
    est.classList.remove('hidden');
    if (approved > 0 && inProgress > 0) {
      const ratio = approved / totalValid;
      const estDays = ratio > 0.5 ? 'faster than average' : ratio > 0.2 ? 'on pace with nearby cases' : 'slower than average';
      est.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <span>Based on ${totalValid} nearby cases: <strong>${rate}% approved</strong> — your case is likely <strong>${estDays}</strong></span>`;
    } else {
      est.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <span>Nearby approval rate: <strong>${rate}%</strong> across ${totalValid} cases</span>`;
    }
  }
}

// ─── Timeline View ───
function renderTimeline() {
  const events = [];
  cases.forEach(c => {
    if (c.history) {
      c.history.forEach(h => {
        events.push({
          receipt: c.receiptNumber, label: c.label,
          status: h.status, statusDetail: h.statusDetail,
          time: new Date(h.checkedAt)
        });
      });
    }
  });
  events.sort((a, b) => b.time - a.time);

  if (events.length === 0) {
    $('timeline-content').innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:40px 0;">No activity recorded yet.</div>';
    openModal('overlay-timeline');
    return;
  }

  const grouped = {};
  events.forEach(e => {
    const dateStr = e.time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(e);
  });

  let html = '';
  for (const [date, dayEvents] of Object.entries(grouped)) {
    html += `<div class="timeline-day"><div class="timeline-date">${date}</div>`;
    dayEvents.forEach(e => {
      const cat = getBadgeText(e.status);
      let dotClass = '';
      if (cat === 'APPROVED' || cat === 'RECEIVED' || cat === 'CARD COMING') dotClass = 'success';
      else if (cat === 'ACTION NEEDED') dotClass = 'warning';
      else if (cat === 'DENIED') dotClass = 'error';
      html += `<div class="timeline-event">
        <div class="timeline-event-dot ${dotClass}"></div>
        <div class="timeline-event-body">
          <div class="timeline-event-case">${e.receipt}${e.label ? ' · ' + esc(e.label) : ''}</div>
          <div class="timeline-event-status">${esc(e.status)}</div>
          <div class="timeline-event-time">${e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  $('timeline-content').innerHTML = html;
  openModal('overlay-timeline');
}

// ─── Comparison View ───
function renderComparison() {
  if (cases.length < 2) { showToast('Need at least 2 cases to compare'); return; }

  let html = '<div class="compare-grid">';
  cases.forEach(c => {
    const progress = getProgressInfo(c.status, c.statusDetail);
    const cat = getBadgeText(c.status);
    const center = getServiceCenter(c.receiptNumber);
    let badgeClass = 'b-neut';
    if (cat === 'APPROVED' || cat === 'RECEIVED' || cat === 'CARD COMING') badgeClass = 'b-appr';
    else if (cat === 'ACTION NEEDED') badgeClass = 'b-rfe';
    else if (cat === 'DENIED') badgeClass = 'b-denied';

    const daysSince = c.lastChanged ? Math.floor((Date.now() - new Date(c.lastChanged).getTime()) / 86400000) : null;
    const updates = c.history ? c.history.length : 0;

    html += `<div class="compare-card">
      <div class="compare-card-header">
        <div>
          <div class="c-receipt">${c.receiptNumber}</div>
          ${c.label ? `<div class="c-alias">${esc(c.label)}</div>` : ''}
        </div>
        <span class="badge ${badgeClass}">${cat}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
      <div class="compare-metrics">
        <div class="compare-metric"><span class="compare-metric-label">Stage</span><span class="compare-metric-value">${progress.stage} · ${progress.percent}%</span></div>
        <div class="compare-metric"><span class="compare-metric-label">Center</span><span class="compare-metric-value">${center.code} — ${center.city}</span></div>
        <div class="compare-metric"><span class="compare-metric-label">Last Change</span><span class="compare-metric-value">${daysSince !== null ? daysSince + 'd ago' : '—'}</span></div>
        <div class="compare-metric"><span class="compare-metric-label">Updates</span><span class="compare-metric-value">${updates}</span></div>
      </div>
    </div>`;
  });
  html += '</div>';

  $('compare-content').innerHTML = html;
  openModal('overlay-compare');
}

// ─── Case Actions ────────────
async function addCase() {
  const receipt = $('input-receipt').value.trim();
  const label = $('input-label').value.trim();
  $('add-error').classList.add('hidden');
  if (!receipt) { $('add-error').textContent = 'Receipt number required.'; $('add-error').classList.remove('hidden'); return; }
  $('btn-add-submit').disabled = true; showLoading();
  try {
    const res = await API.post('/api/cases', { receiptNumber: receipt, label });
    if (!res.ok && res.error) throw new Error(res.error);
    $('input-receipt').value = ''; $('input-label').value = '';
    closeModal('overlay-add');
    await refresh();
    await API.post(`/api/check/${res.id}`);
    await refresh();
  } catch (e) {
    $('add-error').textContent = e.message; $('add-error').classList.remove('hidden');
  } finally { $('btn-add-submit').disabled = false; hideLoading(); }
}

async function checkAll() {
  if (cases.length === 0) return;
  showToast('Refreshing all cases...');
  try { await API.post('/api/check-all'); await refresh(); showToast('All cases refreshed.'); } catch {}
}

window.checkSingle = async function(id) {
  showToast('Checking status...');
  try { await API.post(`/api/check/${id}`); await refresh(); showToast('Updated.'); }
  catch(e) { showToast('Check failed.'); }
};

function promptDeleteCase() {
  if (!selectedCaseId) return;
  openModal('overlay-confirm');
}

async function executeDeleteCase() {
  closeModal('overlay-confirm');
  if (!selectedCaseId) return;
  showLoading();
  try {
    await API.del(`/api/cases/${selectedCaseId}`);
    closeModal('overlay-detail');
    await refresh(); showToast('Case deleted');
  } catch(e) { showToast('Delete failed'); }
  hideLoading();
}

async function applySettings() {
  $('setting-autocheck').checked = !!settings.autoCheckEnabled;
  $('setting-interval').value = settings.checkIntervalHours || 4;
  $('setting-notifications').checked = !!settings.notificationsEnabled;

  // Load share status
  try {
    const share = await API.get('/api/share');
    $('setting-share').checked = share.enabled;
    if (share.enabled && share.token) {
      $('share-link-input').value = location.origin + '/s/' + share.token;
      $('share-link-row').classList.remove('hidden');
    } else {
      $('share-link-row').classList.add('hidden');
    }
  } catch { /* ignore */ }
}

// ─── Push Logic ───
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
}
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await API.get('/api/vapidPublicKey');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await API.post('/api/subscribe', sub);
  } catch (err) { console.error('Push registration failed', err); }
}

// ─── Logs ───
async function refreshLogs() {
  try {
    const logs = await API.get('/api/logs');
    if (!logs.length) { $('log-body').innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px 0;">No activity yet.</div>'; return; }
    $('log-body').innerHTML = logs.map(l => {
      let color = 'var(--text-secondary)';
      if (l.type === 'error') color = 'var(--color-error)';
      if (l.type === 'success') color = 'var(--color-success)';
      return `<div class="mb-3 pb-3 border-bot-glass">
        <div style="color:var(--text-muted); margin-bottom:4px; font-size:12px;">${new Date(l.timestamp).toLocaleString()}</div>
        <div style="color:${color}; font-size:13px;">${esc(l.message)}</div>
      </div>`;
    }).join('');
  } catch {}
}

// ─── Utilities ──────────────────
function showLoading() { $('overlay-loading').classList.remove('hidden'); }
function hideLoading() { $('overlay-loading').classList.add('hidden'); }
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function timeAgo(dStr) {
  if (!dStr) return '—';
  const mins = Math.floor((Date.now() - new Date(dStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function getBadgeText(s) {
  if (!s) return 'PENDING';
  s = s.toLowerCase();
  if (s.includes('approved')||s.includes('delivered')||s.includes('picked up')) return 'APPROVED';
  if (s.includes('denied')||s.includes('rejected')) return 'DENIED';
  if (s.includes('evidence')||s.includes('rfe')) return 'ACTION NEEDED';
  if (s.includes('produced')||s.includes('mailed')) return 'CARD COMING';
  if (s.includes('received')||s.includes('accepted')) return 'RECEIVED';
  return 'IN PROGRESS';
}
