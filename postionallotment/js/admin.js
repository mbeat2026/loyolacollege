/* M-BEAT ADMIN PANEL LOGIC — v2 */

const API_URL = 'https://script.google.com/macros/s/AKfycby1IVEWpaOcluET3tchQaKhY341oJ4Hg-kanfMevGZoh0-MiJudg2U75Qv9VcNP3XLbnQ/exec'; // same URL as js/app.js

let adminState = { token: null };

async function call(action, payload) {
  const body = Object.assign({ action, adminToken: adminState.token }, payload || {});
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

function showLogin(msg) {
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('adminMain').style.display = 'none';
  document.getElementById('loginError').innerHTML = msg ? `<div class="error-msg">${msg}</div>` : '';
}
function showMain() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('adminMain').style.display = 'block';
}

let sessionInterval;
function startCountdown(seconds) {
  const expiresAt = Date.now() + seconds * 1000;
  clearInterval(sessionInterval);
  sessionInterval = setInterval(() => {
    const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    document.getElementById('sessionTimer').textContent = `${m}:${s}`;
    if (remaining <= 0) { clearInterval(sessionInterval); adminState.token = null; showLogin('Admin session expired. Sign in again.'); }
  }, 1000);
}

document.getElementById('adminLoginBtn').addEventListener('click', async () => {
  const pass = document.getElementById('adminPass').value;
  const r = await call('adminLogin', { password: pass });
  if (!r.ok) { showLogin(r.error); return; }
  adminState.token = r.token;
  startCountdown(r.sessionSeconds || 900);
  showMain();
  loadRoster();
  loadCommittee();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  adminState.token = null;
  clearInterval(sessionInterval);
  showLogin();
});

document.getElementById('saveWindowBtn').addEventListener('click', async () => {
  const open = document.getElementById('openDT').value;
  const close = document.getElementById('closeDT').value;
  const r = await call('adminSetWindow', {
    openDateTime: open ? new Date(open).toISOString() : undefined,
    closeDateTime: close ? new Date(close).toISOString() : undefined
  });
  alert(r.ok ? 'Window saved.' : r.error);
});

document.getElementById('addUserBtn').addEventListener('click', async () => {
  const regNo = document.getElementById('addRegNo').value.trim();
  const mobile = document.getElementById('addMobile').value.trim();
  const name = document.getElementById('addName').value.trim();
  const r = await call('adminAddUser', { registerNumber: regNo, mobile, name });
  alert(r.ok ? 'Student added.' : r.error);
  if (r.ok) { document.getElementById('addRegNo').value = ''; document.getElementById('addMobile').value = ''; document.getElementById('addName').value = ''; }
});

document.getElementById('bulkAddBtn').addEventListener('click', async () => {
  const lines = document.getElementById('bulkText').value.split('\n').map(l => l.trim()).filter(Boolean);
  const users = lines.map(line => {
    const [registerNumber, mobile, name] = line.split(',').map(x => (x || '').trim());
    return { registerNumber, mobile, name };
  });
  const r = await call('adminBulkAddUsers', { users });
  alert(r.ok ? `Added ${r.added}, skipped ${r.skipped} (duplicates/invalid).` : r.error);
  if (r.ok) document.getElementById('bulkText').value = '';
});

document.getElementById('fixSlotBtn').addEventListener('click', async () => {
  const slotId = document.getElementById('fixSlotId').value.trim();
  const regNo = document.getElementById('fixRegNo').value.trim();
  const r = await call('adminFixSlot', { slotId, registerNumber: regNo });
  alert(r.ok ? 'Slot fixed to that student.' : r.error);
});

document.getElementById('unfixSlotBtn').addEventListener('click', async () => {
  const slotId = document.getElementById('fixSlotId').value.trim();
  const r = await call('adminUnfixSlot', { slotId });
  alert(r.ok ? 'Slot is now open to everyone.' : r.error);
});

document.getElementById('changeMemberBtn').addEventListener('click', async () => {
  const regNo = document.getElementById('changeRegNo').value.trim();
  const newSlotId = document.getElementById('changeSlotId').value.trim();
  if (!confirm(`Change position for ${regNo}? This overrides the lock.`)) return;
  const r = await call('adminChangeMember', { registerNumber: regNo, newSlotId: newSlotId || undefined });
  alert(r.ok ? 'Updated.' : r.error);
  if (r.ok) loadRoster();
});

document.getElementById('autoAssignBtn').addEventListener('click', async () => {
  if (!confirm('Lock in reserved-but-unclaimed posts and randomly assign remaining unassigned students?')) return;
  const r = await call('adminRunAutoAssign', {});
  document.getElementById('autoAssignResult').textContent = r.ok
    ? `${r.fixedAssigned} reserved post(s) auto-locked. ${r.randomAssigned} students randomly assigned. ${r.stillUnassigned} left unassigned (no seats remaining).`
    : r.error;
  if (r.ok) loadRoster();
});

document.getElementById('addCommitteeBtn').addEventListener('click', async () => {
  const postName = document.getElementById('committeePost').value;
  const memberName = document.getElementById('committeeName').value.trim();
  const memberType = document.getElementById('committeeType').value;
  const registerNumber = document.getElementById('committeeRegNo').value.trim();
  if (!memberName) { alert('Enter a name.'); return; }
  const r = await call('adminAddCommitteeMember', { postName, memberName, memberType, registerNumber });
  alert(r.ok ? 'Added to committee.' : r.error);
  if (r.ok) { document.getElementById('committeeName').value = ''; document.getElementById('committeeRegNo').value = ''; loadCommittee(); }
});

document.getElementById('refreshRosterBtn').addEventListener('click', loadRoster);

async function loadRoster() {
  const r = await call('adminRoster', {});
  if (!r.ok) return;
  const wrap = document.getElementById('rosterTableWrap');
  let html = '<table><thead><tr><th>Register No.</th><th>Zone</th><th>Position</th><th>Method</th><th>Locked At</th></tr></thead><tbody>';
  r.roster.forEach(row => {
    html += `<tr><td>${row.registerNumber}</td><td>${row.zone}</td><td>${row.position}</td><td>${row.method}</td><td>${new Date(row.timestamp).toLocaleString('en-IN')}</td></tr>`;
  });
  html += '</tbody></table>';
  html += `<p style="font-size:12px;color:var(--muted);margin-top:10px;">${r.roster.length} of 62 Tier-2 slots filled.</p>`;
  wrap.innerHTML = html;
}

async function loadCommittee() {
  const r = await call('adminCommitteeList', {});
  if (!r.ok) return;
  const wrap = document.getElementById('committeeListWrap');
  let html = '<table><thead><tr><th>Post</th><th>Name</th><th>Type</th><th>Register No.</th><th></th></tr></thead><tbody>';
  r.committee.forEach(m => {
    html += `<tr><td>${m.postName}</td><td>${m.memberName}</td><td>${m.memberType}</td><td>${m.registerNumber || '—'}</td>
      <td><a href="#" onclick="removeCommittee('${m.postName.replace(/'/g, "\\'")}','${m.memberName.replace(/'/g, "\\'")}');return false;" style="color:var(--rust);">remove</a></td></tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

async function removeCommittee(postName, memberName) {
  if (!confirm(`Remove ${memberName} from ${postName}?`)) return;
  const r = await call('adminRemoveCommitteeMember', { postName, memberName });
  if (r.ok) loadCommittee(); else alert(r.error);
}

showLogin();
