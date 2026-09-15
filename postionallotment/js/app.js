/* =========================================================
   M-BEAT PORTAL — SHARED FRONTEND LOGIC (v2)
   One file, used by login/, selection/, position/, committee/.
   Session token is kept in sessionStorage so it survives page-to-page
   navigation (login -> selection -> position) but clears when the
   browser tab closes. Server still enforces the real 15-min expiry.
   ========================================================= */

const API_URL = 'https://script.google.com/macros/s/AKfycby1IVEWpaOcluET3tchQaKhY341oJ4Hg-kanfMevGZoh0-MiJudg2U75Qv9VcNP3XLbnQ/exec'; // same URL used in admin.js

const ZONE_ORDER = ['Zone 1','Zone 2','Zone 3','Zone 4','Zone 5','Zone 6','Zone 7','Zone 8','Zone 9'];
const POSITION_ORDER = ['Zone Leader','Planning Member','Assessment & Action Member','Documentation Member'];

const ROLE_INFO = [
  { name: 'Chief Zone Leader', desc: 'Oversees and coordinates all 9 zones across Loyola College.' },
  { name: 'Deputy Zone Leader', desc: 'Supports the Chief Zone Leader in coordinating all 9 zones.' },
  { name: 'Zone Leader', desc: 'Coordinates the team within the zone.' },
  { name: 'Planning Member', desc: 'Handles planning and coordination for the zone.' },
  { name: 'Assessment & Action Member', desc: 'Works on ground — breeding-site surveillance and elimination action.' },
  { name: 'Documentation Member', desc: 'Documents findings and prepares reports.' },
  { name: 'Public Relations Team Member', desc: 'Handles outreach and public awareness for M-Beat.' }
];

const MBeat = (function () {

  // ---------------- API ----------------
  async function call(action, payload) {
    const token = sessionStorage.getItem('mbeat_token');
    const body = Object.assign({ action, token }, payload || {});
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
    return res.json();
  }

  // ---------------- Clock ----------------
  function initClock() {
    function tick() {
      const now = new Date();
      const t = document.getElementById('clockTime');
      const d = document.getElementById('clockDate');
      if (t) t.textContent = now.toLocaleTimeString('en-IN', { hour12: true });
      if (d) d.textContent = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    tick();
    setInterval(tick, 1000);
  }

  // ---------------- Session countdown (shared by selection/position pages) ----------------
  let sessionInterval = null;
  function startSessionCountdown(seconds, onExpire) {
    const expiresAt = Date.now() + seconds * 1000;
    clearInterval(sessionInterval);
    sessionInterval = setInterval(() => {
      const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      const el = document.getElementById('sessionTimer');
      if (el) {
        const m = String(Math.floor(remaining / 60)).padStart(2, '0');
        const s = String(remaining % 60).padStart(2, '0');
        el.textContent = `${m}:${s}`;
      }
      if (remaining <= 0) { clearInterval(sessionInterval); onExpire(); }
    }, 1000);
  }

  function clearSession() {
    sessionStorage.removeItem('mbeat_token');
    sessionStorage.removeItem('mbeat_regno');
    sessionStorage.removeItem('mbeat_session_seconds');
  }

  function goLogin(msg) {
    clearSession();
    const url = '../login/' + (msg ? ('?msg=' + encodeURIComponent(msg)) : '');
    window.location.href = url;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function wireLogoutButton() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await call('logout', {});
      goLogin();
    });
  }

  // ---------------- LOGIN PAGE ----------------
  function initLoginPage() {
    const params = new URLSearchParams(window.location.search);
    const msg = params.get('msg');
    if (msg) document.getElementById('loginError').innerHTML = `<div class="error-msg">${escapeHtml(msg)}</div>`;

    const doLogin = async () => {
      const regNo = document.getElementById('regNo').value.trim();
      const mobile = document.getElementById('mobile').value.trim();
      const errBox = document.getElementById('loginError');
      if (!regNo || !mobile) { errBox.innerHTML = '<div class="error-msg">Enter both your register number and mobile number.</div>'; return; }

      const btn = document.getElementById('loginBtn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const r = await call('login', { registerNumber: regNo, mobile: mobile });
        if (!r.ok) { errBox.innerHTML = `<div class="error-msg">${escapeHtml(r.error)}</div>`; return; }
        sessionStorage.setItem('mbeat_token', r.token);
        sessionStorage.setItem('mbeat_regno', regNo);
        sessionStorage.setItem('mbeat_session_seconds', r.sessionSeconds || 900);

        if (r.hasPost) {
          // They already hold a Tier-1 post — nothing to select, still show them a status via position page.
          window.location.href = '../position/';
          return;
        }
        window.location.href = '../selection/';
      } catch (e) {
        errBox.innerHTML = '<div class="error-msg">Could not reach the server. Check your connection and try again.</div>';
      } finally {
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    };

    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('regNo').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('mobile').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  }

  // ---------------- SELECTION PAGE ----------------
  let pollInterval = null;
  let pendingSlot = null;

  async function initSelectionPage() {
    const token = sessionStorage.getItem('mbeat_token');
    if (!token) { goLogin(); return; }

    wireLogoutButton();
    renderRoleInfo();

    const me = await call('me', {});
    if (!me.ok) { goLogin(me.error === 'SESSION_EXPIRED' ? 'Your session expired. Please sign in again.' : me.error); return; }

    document.getElementById('meRegNo').textContent = me.registerNumber;
    startSessionCountdown(Number(sessionStorage.getItem('mbeat_session_seconds')) || 900, () => {
      clearInterval(pollInterval);
      goLogin('Your session expired after 15 minutes of inactivity. Please sign in again.');
    });

    if (me.hasPost) {
      window.location.href = '../position/';
      return;
    }
    if (me.locked) {
      window.location.href = '../position/';
      return;
    }

    wireModals();
    clearInterval(pollInterval);
    refreshSlots(me);
    pollInterval = setInterval(() => refreshSlots(me), 2000);
  }

  function renderRoleInfo() {
    const grid = document.getElementById('roleInfoGrid');
    if (!grid) return;
    grid.innerHTML = ROLE_INFO.map(r => `
      <div class="role-info-card">
        <div class="role-name">${escapeHtml(r.name)}</div>
        <div class="role-desc">${escapeHtml(r.desc)}</div>
      </div>`).join('');
  }

  async function refreshSlots(me) {
    const r = await call('slots', {});
    if (!r.ok) { if (r.error === 'SESSION_EXPIRED') { clearInterval(pollInterval); goLogin('Session expired.'); } return; }
    renderWindowStrip(r.openDateTime, r.closeDateTime);
    renderReservedNotice(r.slots, me.registerNumber);
    renderGrids(r.slots, me.registerNumber);
  }

  function renderWindowStrip(openDT, closeDT) {
    const strip = document.getElementById('windowStrip');
    if (!strip) return;
    const now = new Date();
    const open = new Date(openDT);
    const close = new Date(closeDT);
    const fmt = d => d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
    const isOpen = now >= open && now <= close;
    strip.classList.toggle('closed', !isOpen);
    document.getElementById('windowStatusText').textContent = isOpen ? 'Selection is open' : (now < open ? 'Selection has not opened yet' : 'Selection window has closed');
    document.getElementById('windowTimes').textContent = `Opens ${fmt(open)} · Closes ${fmt(close)}`;
  }

  function renderReservedNotice(slots, myRegNo) {
    const box = document.getElementById('reservedNotice');
    if (!box) return;
    const mine = slots.find(s => s.fixedFor && s.fixedFor.trim().toUpperCase() === myRegNo.trim().toUpperCase());
    box.innerHTML = mine
      ? `<div class="info-msg">You have a reserved position: <strong>${escapeHtml(mine.position)}</strong> (${escapeHtml(mine.zone)}). Select it below to lock it in.</div>`
      : '';
  }

  function renderGrids(slots, myRegNo) {
    const leadershipGrid = document.getElementById('leadershipGrid');
    const zoneGrid = document.getElementById('zoneGrid');
    const prGrid = document.getElementById('prGrid');
    if (leadershipGrid) leadershipGrid.innerHTML = '';
    if (zoneGrid) zoneGrid.innerHTML = '';
    if (prGrid) prGrid.innerHTML = '';

    const leadershipSlots = slots.filter(s => s.zone === 'College');
    if (leadershipGrid && leadershipSlots.length) {
      leadershipGrid.appendChild(buildCard('College-wide', leadershipSlots, myRegNo, false, ''));
    }

    ZONE_ORDER.forEach(zoneName => {
      const zoneSlots = slots.filter(s => s.zone === zoneName);
      if (!zoneSlots.length) return;
      zoneGrid.appendChild(buildCard(zoneName, zoneSlots, myRegNo, false, zoneSlots[0].zoneDetail));
    });

    const prSlots = slots.filter(s => s.zone === 'Public Relations');
    prSlots.forEach(slot => prGrid.appendChild(buildCard('Public Relations', [slot], myRegNo, true, '')));
  }

  function buildCard(title, slots, myRegNo, isPr, zoneDetail) {
    const card = document.createElement('div');
    card.className = 'zone-card';
    const totalCap = slots.reduce((a, s) => a + s.capacity, 0);
    const totalFilled = slots.reduce((a, s) => a + s.filled, 0);

    card.innerHTML = `
      <div class="zone-title">${escapeHtml(title)}</div>
      ${zoneDetail ? `<div class="zone-detail">${escapeHtml(zoneDetail)}</div>` : ''}
      <div class="zone-fill-summary">${totalFilled} / ${totalCap} filled</div>
    `;

    const ordered = isPr ? slots : (title === 'College-wide'
      ? ['Chief Zone Leader', 'Deputy Zone Leader'].map(p => slots.find(s => s.position === p)).filter(Boolean)
      : POSITION_ORDER.map(p => slots.find(s => s.position === p)).filter(Boolean));

    ordered.forEach(slot => {
      const row = document.createElement('div');
      const isFull = slot.filled >= slot.capacity;
      const fixedFor = (slot.fixedFor || '').trim().toUpperCase();
      const isMine = fixedFor && fixedFor === myRegNo.trim().toUpperCase();
      const isFixedForSomeoneElse = fixedFor && !isMine;

      let cls = 'position-row';
      let clickable = false;

      if (isFixedForSomeoneElse) { cls += ' locked-out'; }
      else if (isFull) { cls += ' full'; }
      else if (isMine) { cls += ' reserved-mine'; clickable = true; }
      else { cls += ' selectable'; clickable = true; }

      row.className = cls;
      row.innerHTML = `
        <span class="pos-name">${escapeHtml(slot.position)}${isMine ? ' (reserved for you)' : ''}</span>
        <span title="${escapeHtml(slot.responsibility || '')}" class="info-icon">i</span>
        <span class="pos-count">${slot.filled}/${slot.capacity}</span>
      `;
      if (clickable) row.addEventListener('click', () => openConfirm(slot));
      card.appendChild(row);
    });

    return card;
  }

  function openConfirm(slot) {
    pendingSlot = slot;
    document.getElementById('modalPosition').textContent = slot.position;
    document.getElementById('modalZone').textContent = slot.zone;
    document.getElementById('confirmModal').style.display = 'flex';
  }

  function wireModals() {
    document.getElementById('modalCancel').addEventListener('click', () => {
      document.getElementById('confirmModal').style.display = 'none';
    });

    document.getElementById('modalStep1Confirm').addEventListener('click', async () => {
      const r = await call('selectSlot', { slotId: pendingSlot.slotId });
      if (!r.ok) {
        if (r.error === 'SESSION_EXPIRED') { goLogin('Session expired.'); return; }
        alert(r.error);
        document.getElementById('confirmModal').style.display = 'none';
        return;
      }
      document.getElementById('confirmModal').style.display = 'none';
      document.getElementById('lockPhrase').value = '';
      document.getElementById('finalConfirm').disabled = true;
      document.getElementById('finalModal').style.display = 'flex';
    });

    document.getElementById('lockPhrase').addEventListener('input', e => {
      document.getElementById('finalConfirm').disabled = e.target.value.trim().toUpperCase() !== 'LOCK';
    });

    document.getElementById('finalCancel').addEventListener('click', () => {
      document.getElementById('finalModal').style.display = 'none';
    });

    document.getElementById('finalConfirm').addEventListener('click', async () => {
      const btn = document.getElementById('finalConfirm');
      btn.disabled = true; btn.textContent = 'Locking…';
      const r = await call('confirmSlot', { slotId: pendingSlot.slotId });
      btn.textContent = 'Lock my position';
      document.getElementById('finalModal').style.display = 'none';
      if (!r.ok) {
        if (r.error === 'SESSION_EXPIRED') { goLogin('Session expired.'); return; }
        alert(r.error);
        return;
      }
      window.location.href = '../position/';
    });
  }

  // ---------------- POSITION PAGE ----------------
  async function initPositionPage() {
    const token = sessionStorage.getItem('mbeat_token');
    if (!token) { goLogin(); return; }
    wireLogoutButton();

    const me = await call('me', {});
    if (!me.ok) { goLogin(me.error === 'SESSION_EXPIRED' ? 'Your session expired. Please sign in again.' : me.error); return; }

    document.getElementById('meRegNo').textContent = me.registerNumber;
    startSessionCountdown(Number(sessionStorage.getItem('mbeat_session_seconds')) || 900, () => {
      goLogin('Your session expired after 15 minutes of inactivity. Please sign in again.');
    });

    const statusCard = document.getElementById('statusCard');
    const notLocked = document.getElementById('notLockedNotice');

    if (me.hasPost && !me.locked) {
      statusCard.style.display = 'block';
      document.getElementById('statusPosition').textContent = me.hasPostLabel;
      document.getElementById('statusZone').textContent = 'Committee post (assigned by admin)';
      document.getElementById('statusTime').textContent = '—';
      document.getElementById('statusMethod').textContent = 'Committee assignment';
      return;
    }

    if (me.locked) {
      statusCard.style.display = 'block';
      document.getElementById('statusPosition').textContent = me.registration.position;
      document.getElementById('statusZone').textContent = me.registration.zone;
      document.getElementById('statusTime').textContent = new Date(me.registration.timestamp).toLocaleString('en-IN');
      const methodLabel = { AutoAssigned: 'Automatically assigned', 'AutoAssigned-Fixed': 'Reserved position, auto-confirmed', AdminReassigned: 'Reassigned by admin', Selected: 'Selected by you' };
      document.getElementById('statusMethod').textContent = methodLabel[me.registration.method] || me.registration.method;
    } else {
      notLocked.style.display = 'block';
    }
  }

  // ---------------- COMMITTEE PAGE (public, no login) ----------------
  async function initCommitteePage() {
    const r = await call('committee', {});
    const wrap = document.getElementById('committeeWrap');
    if (!r.ok || !r.committee.length) { wrap.innerHTML = '<p style="color:var(--muted);font-size:13.5px;">Committee list will be published here.</p>'; return; }

    const groups = {};
    r.committee.forEach(m => { (groups[m.postName] = groups[m.postName] || []).push(m); });

    let html = '';
    Object.keys(groups).forEach(postName => {
      html += `<div class="committee-group"><h3>${escapeHtml(postName)}</h3>`;
      groups[postName].forEach(m => {
        html += `<div class="committee-member-row"><span>${escapeHtml(m.memberName)}</span><span class="member-type">${escapeHtml(m.memberType)}</span></div>`;
      });
      html += `</div>`;
    });
    wrap.innerHTML = html;
  }

  return { initClock, initLoginPage, initSelectionPage, initPositionPage, initCommitteePage, call };
})();
