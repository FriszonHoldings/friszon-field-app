const APP_VERSION = '0.5.0-preview';
const DUE_DAYS = 10;
const ACTIONS = ['Count only', 'Refilled', 'Payment collected', 'Payment due not collected', 'Monthly confirmation', 'Packs taken back'];
const SLIP_ACTIONS = ['Refilled', 'Monthly confirmation', 'Packs taken back'];
const PAY_MODES = ['UPI', 'Cash', 'Cheque', 'Bank transfer'];
const TAKEBACK_REASONS = ['Near expiry', 'Damaged', 'Shop leaving'];
const NOT_COLLECTED = ['Owner not there', 'Owner refused', 'Owner asked for time', 'Other'];
const ISSUES = ['None', 'Damage', 'Near expiry', 'Dispute', 'Shop closing', 'Competitor offer', 'Other'];
const BALANCE_REASONS = ['To be collected later', 'Stock returned', 'Stock expired'];

const LIST_VIEWS = ['due', 'all', 'sent', 'menu', 'stock', 'prospects'];
const S = {session: null, data: null, view: 'due', search: '', form: null, outbox: [], toast: '', geo: null, geoWatch: null};
const $app = document.getElementById('app');

function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }
function uid() { const a = new Uint8Array(4); crypto.getRandomValues(a); return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join(''); }
function todayKey(d) { const x = d ? new Date(d) : new Date(); return x.toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'}); }
function daysSince(iso) { if (!iso) return Infinity; const a = new Date(todayKey() + 'T00:00:00+05:30'); const b = new Date(todayKey(iso) + 'T00:00:00+05:30'); return Math.round((a - b) / 86400000); }
function money(n) { return '₹' + (Math.round(Number(n) * 100) / 100).toLocaleString('en-IN'); }
const READY_SKUS = ['VATHAL', 'MOR', 'WSAMBAR', 'AVIAL'];
function productName(sku) {
  const p = (S.data && S.data.products || []).find(x => x.sku === sku);
  if (!p) return sku;
  let pack = p.pack;
  const shop = S.form && S.data ? (S.data.shops || []).find(x => x.shop_id === S.form.shop_id) : null;
  if (shop && shop.pack_size && pack === '50g' && READY_SKUS.indexOf(sku) < 0) pack = shop.pack_size + 'g';
  return p.name + (pack ? ' (' + pack + ')' : '');
}

function toast(msg, ms) { S.toast = msg; renderToast(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = ''; renderToast(); }, ms || 3000); }
function renderToast() { let el = document.getElementById('toast'); if (!S.toast) { if (el) el.remove(); return; } if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); } el.textContent = S.toast; }

async function logClient(level, message, detail) {
  try { const q = (await ffGet('clientLog')) || []; q.push({at: new Date().toISOString(), level: level, message: message, detail: detail || ''}); await ffSet('clientLog', q.slice(-100)); } catch (e) {}
}
window.addEventListener('error', e => logClient('error', e.message, (e.error && e.error.stack) || ''));
window.addEventListener('unhandledrejection', e => logClient('error', 'promise', String(e.reason && e.reason.stack || e.reason)));

async function flushClientLog() {
  const q = (await ffGet('clientLog')) || [];
  if (!q.length || !S.session || !navigator.onLine) return;
  const res = await ffApi(Object.assign({op: 'log', entries: q}, ffCred(S.session))).catch(() => null);
  if (res && res.ok) await ffSet('clientLog', []);
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => logClient('error', 'sw register', String(e)));
    navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.type === 'synced') refreshOutbox(); });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  S.session = await ffGet('session');
  S.data = await ffGet('data');
  await refreshOutbox();
  const draft = await ffGet('draft');
  if (draft && S.session) { S.form = draft; S.view = 'visit'; startGeo(); }
  render();
  if (S.session) { syncNow(); }
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (navigator.onLine) syncNow(); }, 60000);
}

async function refreshOutbox() { S.outbox = await ffOutboxAll(); S.sentLog = (await ffGet('sentLog')) || []; renderHeaderStatus(); if (S.view === 'sent') render(); }

async function syncNow() {
  if (!S.session) return;
  if (!S.session.t) await upgradeSession();
  if (S.outbox.length) {
    await ffSyncOutbox(() => refreshOutbox());
    await refreshOutbox();
  }
  if (!S.outbox.filter(x => !x.permanent).length && navigator.onLine && S.view !== 'visit') await pullData(false);
  flushClientLog();
  if ('serviceWorker' in navigator && S.outbox.length) {
    navigator.serviceWorker.ready.then(r => r.sync && r.sync.register('ff-outbox')).catch(() => {});
  }
}

let pullTry = 0, pullTimer = null;
async function pullData(showToast) {
  if (!S.session) return;
  if (!S.session.t) { await upgradeSession(); if (!S.session || !S.session.t) return; }
  clearTimeout(pullTimer);
  S.loading = true; pullTry++; if (!S.data) render();
  let res = null;
  for (let k = 0; k < 4 && !(res && (res.ok || res.error === 'auth')); k++) {
    res = await ffGetApi(Object.assign({op: 'bootstrap'}, ffCred(S.session)), 20000).catch(e => ({ok: false, error: 'network', detail: String(e)}));
    if (res && res.ok && !Array.isArray(res.shops)) res = {ok: false, error: 'bad_response', detail: 'no shops in reply'};
  }
  S.loading = false;
  if (!(res && res.ok)) logClient('warn', 'bootstrap failed', (res && (res.error + ' ' + (res.detail || ''))) || '');
  if (res && res.ok && !res.test) {
    S.session = null; S.data = null; await ffSet('session', null); await ffSet('data', null);
    renderLogin(); document.getElementById('lerr').innerHTML = '<div class="err">This preview is only for test logins. Use the normal Friszon Field app.</div>';
    return;
  }
  if (res && res.ok) {
    pullTry = 0;
    S.authProblem = false;
    res.pulledAt = Date.now();
    S.data = res;
    await ffSet('data', res);
    if (showToast) toast('Updated');
    if (LIST_VIEWS.indexOf(S.view) > -1) render();
  } else if (res && res.error === 'auth') {
    S.authProblem = true; renderHeaderStatus();
    logClient('warn', 'token rejected');
    toast('PIN not accepted. Call Ashwin. Your saved visits are safe on this phone.', 6000);
  } else {
    if (showToast) toast('No connection. Showing saved data.');
    if (!S.data) { render(); pullTimer = setTimeout(() => pullData(false), 15000); }
  }
}

async function upgradeSession() {
  if (!S.session || S.session.t || !S.session.pin) return;
  const res = await loginCall(S.session.email, S.session.pin);
  if (res && res.ok && res.t) { S.session = {email: S.session.email, name: res.rep.name, u: res.u, t: res.t}; await ffSet('session', S.session); }
  else if (res && res.error === 'auth') { S.authProblem = true; renderHeaderStatus(); }
}

async function loginCall(email, pin) {
  let res = null;
  for (let k = 0; k < 4 && !(res && (res.ok || res.error === 'auth')); k++) {
    res = await ffApi({email: email, pin: pin, op: 'login'}, 20000).catch(() => ({ok: false, error: 'network'}));
  }
  return res;
}

function visitedTodaySet() {
  const set = {};
  const tk = todayKey();
  (S.data && S.data.visitedToday || []).forEach(v => { set[v.shop_id] = true; });
  S.outbox.filter(o => o.type === 'visit' && todayKey(o.payload.visit_time) === tk).forEach(o => { set[o.payload.shop_id] = true; });
  return set;
}

function sentTodayLocal() { return (S.sentLog || []).filter(s => s.type === 'visit' && todayKey(s.saved_at) === todayKey()); }

function shopRows() {
  const d = S.data; if (!d) return [];
  const todayBy = {}; (d.today || []).forEach(t => { todayBy[t.shop_id] = t; });
  const visited = visitedTodaySet();
  sentTodayLocal().forEach(s => { visited[s.shop_id] = true; });
  return d.shops.filter(s => s.status === 'Active').map(s => {
    const t = todayBy[s.shop_id] || {};
    const days = daysSince(t.last_visit);
    const due = !visited[s.shop_id] && (!t.last_visit || days >= DUE_DAYS || /Collect/.test(t.flag || ''));
    return Object.assign({}, s, {t: t, days: days, due: due, visitedToday: !!visited[s.shop_id]});
  });
}

function renderHeaderStatus() {
  const el = document.getElementById('sync-status'); if (!el) return;
  const waiting = S.outbox.filter(x => !x.permanent).length;
  const stuck = S.outbox.filter(x => x.permanent).length;
  el.className = 'status' + (stuck || S.authProblem ? ' err' : waiting ? ' wait' : '');
  el.textContent = S.authProblem ? 'PIN problem – call Ashwin' : stuck ? stuck + ' need attention' : waiting ? waiting + ' waiting to send' : 'All sent ✓';
}

function render() {
  if (!S.session) return renderLogin();
  if (S.view === 'visit' && S.form) return renderVisit();
  if (S.view === 'pad') return renderPad();
  if (S.view === 'menu') return renderMenu();
  if (S.view === 'dayclose') return renderDayClose();
  if (S.view === 'deposit' && S.dep) return renderDeposit();
  if (S.view === 'stock') return renderStock();
  if (S.view === 'receipt' && S.rc) return renderReceipt();
  if (S.view === 'monthclose' && S.mc) return renderMonthClose();
  if (S.view === 'prospects') return renderProspects();
  if (S.view === 'prospect' && S.pr) return renderProspect();
  const tabs = [['due', 'Shops Due'], ['all', 'My Shops'], ['sent', 'Sent']];
  let body = '';
  if (!S.data) body = `<div class="empty">${S.loading ? 'Loading your shops…' + (pullTry > 1 ? ' (try ' + pullTry + ')' : '') : 'Could not load your shops yet. Trying again automatically.'}<br><br><button class="btn small ghost" onclick="pullData(true)">Try now</button></div>`;
  else if (S.view === 'sent') body = renderSent();
  else body = renderList(S.view === 'due');
  const dueCount = S.data ? shopRows().filter(r => r.due).length : '…';
  const allCount = S.data ? shopRows().length : '…';
  $app.innerHTML = `
    <header class="top"${S.data && S.data.test ? ' style="background:#8a5a00"' : ''}><h1>Friszon Field${S.data && S.data.test ? ' · TEST' : ''}</h1><span id="sync-status" class="status"></span><button onclick="menu()">☰</button></header>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" onclick="go('${k}')">${l}${k === 'due' ? ' (' + dueCount + ')' : k === 'all' ? ' (' + allCount + ')' : ''}</button>`).join('')}</nav>
    <main>${body}</main>`;
  renderHeaderStatus();
}

function go(v) { S.view = v; S.search = ''; render(); window.scrollTo(0, 0); }

function renderList(dueOnly) {
  let rows = shopRows();
  if (dueOnly) rows = rows.filter(r => r.due).sort((a, b) => (a.t.last_visit || '') < (b.t.last_visit || '') ? -1 : 1);
  else rows = rows.sort((a, b) => a.shop_name.localeCompare(b.shop_name));
  const q = S.search.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.shop_name.toLowerCase().indexOf(q) > -1 || r.shop_id.toLowerCase().indexOf(q) > -1);
  const list = rows.map(r => {
    const flags = (r.t.flag || '').split('|').map(x => x.trim()).filter(Boolean);
    const chips = flags.map(f => `<span class="chip ${/Collect|overdue/i.test(f) ? 'red' : /confirmation|10\+/.test(f) ? 'amber' : ''}">${esc(f)}</span>`).join('');
    const done = r.visitedToday ? '<span class="chip">Visited today</span>' : '';
    return `<button class="shop" onclick="openVisit('${esc(r.shop_id)}')"><div class="name">${esc(r.shop_name)}</div><div class="meta">${esc(r.shop_id)} · ${r.t.last_visit ? 'last visit ' + (r.days === 0 ? 'today' : r.days + ' days ago') : 'never visited'}${r.t.amount_due ? ' · due ' + money(r.t.amount_due) : ''}</div><div class="meta">${esc(r.t.refill_plan || '')}</div>${chips}${done}</button>`;
  }).join('');
  return `<input class="search" placeholder="Search shop" value="${esc(S.search)}" oninput="S.search=this.value;document.getElementById('list').innerHTML=renderListInner(${dueOnly})">
    <div id="list">${list || `<div class="empty">${dueOnly ? 'No shops due. Well done.' : 'No shops.'}</div>`}</div>`;
}

function renderListInner(dueOnly) { const tmp = document.createElement('div'); tmp.innerHTML = renderList(dueOnly); return tmp.querySelector('#list').innerHTML; }

function renderSent() {
  const why = e => /network|fetch|abort/i.test(e || '') ? 'no signal' : /bad_response|retry|server/i.test(e || '') ? 'office server busy' : (e || '');
  const waiting = S.outbox.map(o => `<div class="outbox-item"><b>${esc(o.label || o.type)}</b><br><span class="small">Saved ${new Date(o.created).toLocaleTimeString('en-IN')} · ${o.permanent ? '<span style="color:var(--red)">Rejected: ' + esc(o.lastError) + ' – call Ashwin</span>' : 'will send automatically' + (o.attempts ? ' (tried ' + o.attempts + 'x, ' + esc(why(o.lastError)) + ')' : '')}</span></div>`).join('');
  const sent = (S.sentLog || []).slice(0, 50).map(s => `<div class="outbox-item">${esc(s.label || s.type)}<br><span class="small">Saved ${new Date(s.saved_at).toLocaleString('en-IN')} · sent ${new Date(s.sent_at).toLocaleTimeString('en-IN')} ✓</span></div>`).join('');
  return `<div class="card"><h2>Waiting to send (${S.outbox.length})</h2>${waiting || '<div class="small">Nothing waiting. Everything has reached the office.</div>'}<br><button class="btn small ghost" onclick="manualSync()">Send now</button></div>
    <div class="card"><h2>Sent from this phone</h2>${sent || '<div class="small">Nothing yet.</div>'}</div>`;
}

async function manualSync() { toast('Sending…'); await syncNow(); S.sentLog = (await ffGet('sentLog')) || []; render(); toast(S.outbox.length ? S.outbox.length + ' still waiting' : 'All sent ✓'); }

function menu() { S.view = 'menu'; render(); window.scrollTo(0, 0); }

function topBar(title, back) {
  return `<header class="top"${S.data && S.data.test ? ' style="background:#8a5a00"' : ''}><button onclick="${back || "go('due')"}">←</button><h1>${esc(title)}</h1><span id="sync-status" class="status"></span></header>`;
}

function renderMenu() {
  const dc = dayClosedToday();
  const n = depositCandidates('Cash').length + depositCandidates('Cheque').length;
  $app.innerHTML = topBar('Menu') + `<main>
    <button class="shop" onclick="openDayClose()"><div class="name">Day Close</div><div class="meta">${dc ? 'Done for today ✓' : 'Not done yet today – do it before 7 pm'}</div></button>
    <button class="shop" onclick="openDeposit()"><div class="name">Bank Deposit</div><div class="meta">${n ? n + ' cash/cheque collection' + (n > 1 ? 's' : '') + ' not yet deposited' : 'Nothing waiting to be deposited'}</div></button>
    <button class="shop" onclick="openStock()"><div class="name">Stock Received</div><div class="meta">${stockMenuText()}</div></button>
    <button class="shop" onclick="openMonthClose()"><div class="name">Month Close</div><div class="meta">${monthCloseMenuText()}</div></button>
    <button class="shop" onclick="openProspects()"><div class="name">New shops (Prospects)</div><div class="meta">${prospectMenuText()}</div></button>
    <button class="shop" onclick="S.view='pad';S.pad={pad_id:'P'+uid(),first_no:'',last_no:'',photo:''};render()"><div class="name">Add a slip pad</div><div class="meta">When you get a new pad of slips</div></button>
    <button class="shop" onclick="go('due');pullData(true)"><div class="name">Refresh shops</div><div class="meta">${S.data && S.data.pulledAt ? 'Last updated ' + new Date(S.data.pulledAt).toLocaleString('en-IN') : ''}</div></button>
    <button class="shop" onclick="signOut()"><div class="name">Sign out</div><div class="meta">Only when nothing is waiting to send</div></button>
    <div class="small" style="text-align:center;margin-top:16px">App version ${APP_VERSION}</div></main>`;
  renderHeaderStatus();
}

function paymentsToday() {
  const tk = todayKey(), seen = {}, out = [];
  const add = (id, mode, amt, paid) => { if (seen[id]) return; seen[id] = 1; if (paid && Number(amt) > 0) out.push({mode: mode, amount: Number(amt)}); };
  (S.data && S.data.visitedToday || []).forEach(v => add(v.visit_id, v.pay_mode, v.amount, v.paid));
  S.outbox.filter(o => o.type === 'visit' && todayKey(o.payload.visit_time) === tk).forEach(o => add(o.payload.visit_id, o.payload.fields.pay_mode, o.payload.fields.amount, (o.payload.fields.what_happened || []).indexOf('Payment collected') > -1));
  (S.sentLog || []).filter(x => x.type === 'visit' && x.visit_time && todayKey(x.visit_time) === tk).forEach(x => add(x.id, x.pay_mode, x.amount, x.paid));
  return {seen: Object.keys(seen).length, cash: out.filter(x => x.mode === 'Cash').reduce((a, x) => a + x.amount, 0), cheques: out.filter(x => x.mode === 'Cheque').length, chequeAmt: out.filter(x => x.mode === 'Cheque').reduce((a, x) => a + x.amount, 0), upi: out.filter(x => x.mode === 'UPI' || x.mode === 'Bank transfer').reduce((a, x) => a + x.amount, 0)};
}

function dayClosedToday() {
  const tk = todayKey();
  return !!((S.data && S.data.dayClosed && S.data.todayDate === tk) || S.outbox.some(o => o.type === 'dayclose' && o.payload.close_date === tk) || (S.sentLog || []).some(x => x.type === 'dayclose' && x.close_date === tk));
}

function openDayClose() { S.dc = {note: '', confirm: false}; S.view = 'dayclose'; render(); window.scrollTo(0, 0); }

function renderDayClose() {
  const p = paymentsToday();
  const waitingVisits = S.outbox.filter(o => o.type === 'visit').length;
  const done = dayClosedToday();
  let h = topBar('Day Close', 'menu()') + `<main><div class="card"><h2>${new Date().toLocaleDateString('en-IN', {weekday: 'long', day: 'numeric', month: 'long'})}</h2>
    <div class="row"><div class="label">Visits logged today</div><b>${p.seen}</b></div>
    <div class="row"><div class="label">Cash collected today<small>Deposit by 1 pm next working day</small></div><b>${money(p.cash)}</b></div>
    <div class="row"><div class="label">Cheques collected today</div><b>${p.cheques}${p.cheques ? ' · ' + money(p.chequeAmt) : ''}</b></div>
    <div class="row"><div class="label">UPI / bank transfer today<small>Goes straight to the company</small></div><b>${money(p.upi)}</b></div></div>`;
  if (waitingVisits) h += `<div class="warn">${waitingVisits} visit${waitingVisits > 1 ? 's' : ''} not yet sent – they will send automatically. You can still close the day.</div>`;
  if (done) h += `<div class="ok">Day Close is done for today ✓</div></main>`;
  else h += `<div class="card"><label class="field">Note (optional)</label><textarea oninput="S.dc.note=this.value">${esc(S.dc.note)}</textarea>
    <label class="check"><input type="checkbox" ${S.dc.confirm ? 'checked' : ''} onchange="S.dc.confirm=this.checked;document.getElementById('dcbtn').disabled=!this.checked"> I confirm all my visits today are logged</label>
    <br><button class="btn" id="dcbtn" ${S.dc.confirm ? '' : 'disabled'} onclick="saveDayClose()">Submit Day Close</button></div></main>`;
  $app.innerHTML = h;
  renderHeaderStatus();
}

async function saveDayClose() {
  if (!S.dc.confirm || dayClosedToday()) return;
  const id = 'DC' + uid();
  await ffOutboxPut({id: id, type: 'dayclose', payload: {dayclose_id: id, close_date: todayKey(), note: S.dc.note, confirm: true, saved_at: new Date().toISOString()}, created: Date.now(), label: 'Day Close ' + new Date().toLocaleDateString('en-IN')});
  await refreshOutbox();
  toast('Day Close saved ✓'); S.view = 'due'; render();
  syncNow();
}

function depositedIds() {
  const d = {};
  S.outbox.filter(o => o.type === 'deposit').forEach(o => (o.payload.collections || []).forEach(id => { d[id] = 1; }));
  (S.sentLog || []).filter(x => x.type === 'deposit').forEach(x => (x.collections || []).forEach(id => { d[id] = 1; }));
  return d;
}

function depositCandidates(type) {
  const tk = todayKey(), dep = depositedIds(), seen = {}, out = [];
  const shopName = id => { const s = (S.data && S.data.shops || []).find(x => x.shop_id === id); return s ? s.shop_name : id; };
  const add = c => { if (seen[c.visit_id] || dep[c.visit_id] || c.pay_mode !== type || !(Number(c.amount) > 0)) return; seen[c.visit_id] = 1; c.future = type === 'Cheque' && c.cheque_date && c.cheque_date > tk; out.push(c); };
  (S.data && S.data.depositable || []).forEach(c => add(Object.assign({}, c)));
  S.outbox.filter(o => o.type === 'visit' && (o.payload.fields.what_happened || []).indexOf('Payment collected') > -1).forEach(o => add({visit_id: o.payload.visit_id, shop_id: o.payload.shop_id, shop_name: shopName(o.payload.shop_id), visit_time: o.payload.visit_time, pay_mode: o.payload.fields.pay_mode, amount: o.payload.fields.amount, slip_no: o.payload.fields.slip_no, cheque_date: o.payload.fields.cheque_date, unsent: true}));
  (S.sentLog || []).filter(x => x.type === 'visit' && x.paid).forEach(x => add({visit_id: x.id, shop_id: x.shop_id, shop_name: shopName(x.shop_id), visit_time: x.visit_time, pay_mode: x.pay_mode, amount: x.amount, slip_no: x.slip_no, cheque_date: x.cheque_date}));
  return out.sort((a, b) => (a.visit_time || '') < (b.visit_time || '') ? -1 : 1);
}

async function openDeposit() {
  const draft = await ffGet('depDraft');
  S.dep = draft || {deposit_id: 'DP' + uid(), type: '', picks: {}, lines: [], slip_amount: '', bank_branch: '', deposit_ref: '', slip_photo: '', note: ''};
  S.view = 'deposit'; render(); window.scrollTo(0, 0);
}

function depDraft() { clearTimeout(depDraft.t); depDraft.t = setTimeout(() => ffSet('depDraft', S.dep), 300); }

function depInvoices(shopId, lineIdx) {
  const pending = {};
  S.outbox.filter(o => o.type === 'visit').forEach(o => (o.payload.lines || []).forEach(l => { pending[l.invoice_no] = (pending[l.invoice_no] || 0) + Number(l.amount); }));
  S.outbox.filter(o => o.type === 'deposit').forEach(o => (o.payload.lines || []).forEach(l => (l.splits || []).forEach(x => { pending[x.invoice_no] = (pending[x.invoice_no] || 0) + Number(x.amount); })));
  S.dep.lines.forEach((l, k) => { if (k !== lineIdx) Object.keys(l.splits || {}).forEach(inv => { pending[inv] = (pending[inv] || 0) + (Number(l.splits[inv].amount) || 0); }); });
  return (S.data.invoices || []).filter(i => i.shop_id === shopId).map(i => Object.assign({}, i, {balance: Math.round((i.balance - (pending[i.invoice_no] || 0)) * 100) / 100})).filter(i => i.balance > 0.009);
}

function depTotal() {
  const c = depositCandidates(S.dep.type).filter(x => S.dep.picks[x.visit_id]).reduce((a, x) => a + Number(x.amount), 0);
  const l = S.dep.lines.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  return Math.round((c + l) * 100) / 100;
}

function depValidate() {
  const d = S.dep, m = [];
  if (!d.type) { m.push('Cash or Cheque'); return m; }
  const picked = depositCandidates(d.type).filter(x => d.picks[x.visit_id]);
  if (!picked.length && !d.lines.length) m.push('Tick the collections in this deposit, or add an older payment');
  d.lines.forEach((l, k) => {
    const n = 'Older payment ' + (k + 1);
    if (!l.shop_id) { m.push(n + ': shop'); return; }
    if (!(Number(l.amount) > 0)) m.push(n + ': total amount');
    if (d.type === 'Cheque') {
      if (!String(l.cheque_no || '').trim()) m.push(n + ': cheque number');
      if (!l.cheque_date) m.push(n + ': cheque date');
      else { const days = daysSince(l.cheque_date + 'T12:00:00+05:30'); if (days > 90 || days < 0) m.push(n + ': cheque date must be within the last 90 days'); }
    }
    const inv = depInvoices(l.shop_id, k);
    const sp = Object.keys(l.splits || {}).filter(x => Number(l.splits[x].amount) > 0);
    if (!sp.length) m.push(n + ': split it across the shop\'s invoices');
    const sum = sp.reduce((a, x) => a + Number(l.splits[x].amount), 0);
    if (sp.length && Math.abs(sum - (Number(l.amount) || 0)) > 0.009) m.push(n + ': split adds up to ' + money(sum) + ', total is ' + money(l.amount || 0));
    sp.forEach(x => { const i = inv.find(y => y.invoice_no === x); const a = Number(l.splits[x].amount); if (!i) m.push(n + ': invoice ' + x + ' is not open'); else if (a > i.balance + 0.009) m.push(n + ': ' + x + ' more than its balance ' + money(i.balance)); else if (a < i.balance - 0.009 && !l.splits[x].balance_reason) m.push(n + ': ' + x + ' – what happens to the remaining ' + money(i.balance - a)); });
  });
  const total = depTotal();
  if (!(Number(d.slip_amount) > 0)) m.push('Amount on the bank slip');
  else if (Math.abs(Number(d.slip_amount) - total) > 0.009) m.push('Slip amount must equal ' + money(total) + ' (the collections ticked + older payments)');
  if (!String(d.bank_branch).trim()) m.push('Bank branch');
  if (!d.slip_photo) m.push('Photo of the stamped deposit slip');
  return m;
}

function depMissing() {
  const el = document.getElementById('missing'); if (!el) return;
  const m = depValidate(); const shown = S.showAllMissing ? m : m.slice(0, 2);
  el.innerHTML = m.length ? 'Still needed: ' + shown.map(esc).join(' · ') + (m.length > shown.length ? ` <u onclick="S.showAllMissing=true;depMissing()">+${m.length - shown.length} more</u>` : '') : '';
  document.getElementById('savebtn').textContent = m.length ? 'Save deposit (' + m.length + ' to fill)' : 'Save deposit';
  const t = document.getElementById('deptotal'); if (t) t.textContent = money(depTotal());
}

function depSet(k, v, rerender) { S.dep[k] = v; depDraft(); if (rerender) renderDeposit(true); else depMissing(); }
function depPick(id, on) { S.dep.picks[id] = on; depDraft(); depMissing(); }
function depType(t) { if (S.dep.type !== t) { S.dep.type = t; S.dep.picks = {}; } depDraft(); renderDeposit(true); }
function depAddLine() { S.dep.lines.push({shop_id: '', amount: '', cheque_no: '', cheque_date: '', splits: {}}); depDraft(); renderDeposit(true); }
function depDelLine(k) { S.dep.lines.splice(k, 1); depDraft(); renderDeposit(true); }
function depLine(k, f, v, rerender) { S.dep.lines[k][f] = v; if (f === 'shop_id') S.dep.lines[k].splits = {}; depDraft(); if (rerender) renderDeposit(true); else depMissing(); }
function depSplit(k, inv, f, v) {
  const l = S.dep.lines[k]; l.splits[inv] = l.splits[inv] || {amount: '', balance_reason: ''}; l.splits[inv][f] = v; depDraft();
  if (f === 'amount') { const i = depInvoices(l.shop_id, k).find(x => x.invoice_no === inv); const el = document.getElementById('dr-' + k + '-' + inv.replace(/[^A-Za-z0-9]/g, '')); if (el && i) el.innerHTML = depRemHtml(k, i, l.splits[inv]); }
  depMissing();
}
function depRemHtml(k, i, sp) {
  const a = Number(sp.amount); if (!(a > 0 && a < i.balance - 0.009)) return '';
  return `<label class="field">Remaining ${money(i.balance - a)} on this invoice is:</label><select onchange="depSplit(${k},'${esc(i.invoice_no)}','balance_reason',this.value)"><option value="">Choose</option>${BALANCE_REASONS.map(r => `<option ${sp.balance_reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
}

function depPhoto() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => { const file = input.files && input.files[0]; if (!file) return; try { S.dep.slip_photo = await compress(file); depDraft(); renderDeposit(true); } catch (e) { toast('Photo failed. Try again.'); } };
  input.click();
}

async function cancelDeposit() {
  if ((S.dep.type || S.dep.lines.length) && !confirm('Leave without saving this deposit? What you entered will be lost.')) return;
  await ffSet('depDraft', null); S.dep = null; menu();
}

function renderDeposit(keepScroll) {
  const y = window.scrollY, d = S.dep;
  let h = topBar('Bank Deposit', 'cancelDeposit()') + `<main><div class="card"><h2>What did you deposit?</h2><div class="choices">${['Cash', 'Cheque'].map(t => `<button class="${d.type === t ? 'on' : ''}" onclick="depType('${t}')">${t}</button>`).join('')}</div><div class="small" style="margin-top:8px">Deposit cash and cheques separately – one deposit each.</div></div>`;
  if (d.type) {
    const cands = depositCandidates(d.type);
    h += `<div class="card"><h2>1. Collections in this deposit</h2>${cands.length ? cands.map(c => `<label class="check"><input type="checkbox" ${d.picks[c.visit_id] ? 'checked' : ''} ${c.future ? 'disabled' : ''} onchange="depPick('${esc(c.visit_id)}',this.checked)"> <span><b>${esc(c.shop_name)}</b> · ${money(c.amount)}<br><span class="small">${c.visit_time ? new Date(c.visit_time).toLocaleDateString('en-IN') : ''}${c.slip_no ? ' · slip ' + esc(c.slip_no) : ''}${c.future ? ' · cheque dated ' + esc(c.cheque_date) + ' – cannot deposit yet' : ''}${c.unsent ? ' · visit not yet sent' : ''}</span></span></label>`).join('') : `<div class="small">No ${d.type.toLowerCase()} collections waiting to be deposited.</div>`}</div>`;
    h += `<div class="card"><h2>2. Older payments not logged in the app</h2><div class="small">Only for ${d.type.toLowerCase()} collected before the app (or never logged). Split each one across that shop's open invoices.</div>`;
    d.lines.forEach((l, k) => {
      h += `<div class="line"><div class="top"><span>Older payment ${k + 1}</span><span onclick="depDelLine(${k})" style="color:var(--red)">Remove</span></div>
        <select onchange="depLine(${k},'shop_id',this.value,true)"><option value="">Choose shop</option>${(S.data.shops || []).filter(s => s.status === 'Active').sort((a, b) => a.shop_name.localeCompare(b.shop_name)).map(s => `<option value="${esc(s.shop_id)}" ${l.shop_id === s.shop_id ? 'selected' : ''}>${esc(s.shop_name)}</option>`).join('')}</select>
        <label class="field">Total amount of this ${d.type === 'Cheque' ? 'cheque' : 'cash'} (₹)</label><input class="text" inputmode="decimal" value="${esc(l.amount)}" oninput="depLine(${k},'amount',this.value.replace(/[^0-9.]/g,''))">`;
      if (d.type === 'Cheque') h += `<label class="field">Cheque number</label><input class="text" inputmode="numeric" value="${esc(l.cheque_no)}" oninput="depLine(${k},'cheque_no',this.value.trim())"><label class="field">Date written on the cheque</label><input class="text" type="date" value="${esc(l.cheque_date)}" onchange="depLine(${k},'cheque_date',this.value)">`;
      if (l.shop_id) {
        const inv = depInvoices(l.shop_id, k);
        h += inv.length ? `<label class="field">Split across invoices</label>${inv.map(i => { const sp = l.splits[i.invoice_no] || {amount: '', balance_reason: ''}; return `<div class="line"><div class="top"><span>${esc(i.label || i.invoice_no)}</span><span>balance ${money(i.balance)}</span></div><input class="text" inputmode="decimal" placeholder="Amount against this invoice" value="${esc(sp.amount)}" oninput="depSplit(${k},'${esc(i.invoice_no)}','amount',this.value.replace(/[^0-9.]/g,''))"><div id="dr-${k}-${i.invoice_no.replace(/[^A-Za-z0-9]/g, '')}">${depRemHtml(k, i, sp)}</div></div>`; }).join('')}` : '<div class="err">This shop has no open invoices. Call Ashwin before depositing this payment.</div>';
      }
      h += `</div>`;
    });
    h += `<br><button class="btn small ghost" onclick="depAddLine()">+ Add an older payment</button></div>`;
    h += `<div class="card"><h2>3. Bank slip</h2><div class="row"><div class="label">Total of 1 + 2</div><b id="deptotal">${money(depTotal())}</b></div>
      <label class="field">Amount on the bank deposit slip (₹)</label><input class="text" inputmode="decimal" value="${esc(d.slip_amount)}" oninput="depSet('slip_amount',this.value.replace(/[^0-9.]/g,''))">
      <label class="field">Bank branch</label><input class="text" value="${esc(d.bank_branch)}" oninput="depSet('bank_branch',this.value)">
      <label class="field">Reference / challan number (if any)</label><input class="text" value="${esc(d.deposit_ref)}" oninput="depSet('deposit_ref',this.value)">
      <label class="field">Photo of the stamped deposit slip</label><div class="photo">${d.slip_photo ? `<img src="${d.slip_photo}">` : ''}<button class="btn small ${d.slip_photo ? 'ghost' : ''}" onclick="depPhoto()">${d.slip_photo ? 'Retake photo' : 'Take photo'}</button></div>
      <label class="field">Note (optional)</label><textarea oninput="depSet('note',this.value)">${esc(d.note)}</textarea></div>`;
  }
  h += `</main><div class="savebar"><div class="inner"><div class="missing" id="missing"></div><button class="btn" id="savebtn" onclick="saveDeposit()">Save deposit</button></div></div>`;
  $app.innerHTML = h;
  renderHeaderStatus(); depMissing();
  if (keepScroll) window.scrollTo(0, y);
}

async function saveDeposit() {
  const m = depValidate();
  if (m.length) { S.showAllMissing = true; depMissing(); toast('Fill the items listed in red first'); return; }
  const d = S.dep;
  const cols = depositCandidates(d.type).filter(x => d.picks[x.visit_id] && !x.future).map(x => x.visit_id);
  const lines = d.lines.map(l => ({shop_id: l.shop_id, amount: Number(l.amount), cheque_no: l.cheque_no, cheque_date: l.cheque_date, splits: Object.keys(l.splits).filter(x => Number(l.splits[x].amount) > 0).map(x => ({invoice_no: x, amount: Number(l.splits[x].amount), balance_reason: l.splits[x].balance_reason || ''}))}));
  const payload = {deposit_id: d.deposit_id, deposit_type: d.type, collections: cols, lines: lines, slip_amount: Number(d.slip_amount), bank_branch: d.bank_branch.trim(), deposit_ref: d.deposit_ref.trim(), slip_photo: d.slip_photo, note: d.note, saved_at: new Date().toISOString()};
  await ffOutboxPut({id: d.deposit_id, type: 'deposit', payload: payload, created: Date.now(), label: 'Bank deposit – ' + d.type + ' ' + money(d.slip_amount)});
  await ffSet('depDraft', null); S.dep = null;
  await refreshOutbox();
  toast('Deposit saved ✓'); S.view = 'due'; render();
  syncNow();
}

async function signOut() {
  if (S.outbox.length) { alert('You have ' + S.outbox.length + ' item(s) not yet sent. Connect to the internet and wait until they are sent before signing out.'); return; }
  if (!confirm('Sign out of this phone?')) return;
  await ffSet('session', null); await ffSet('data', null); S.session = null; S.data = null; render();
}

function renderLogin() {
  $app.innerHTML = `<div class="login"><h1>Friszon Field · PREVIEW</h1><p class="small">Test logins only. Saves go to the TEST tabs.</p>
    <label class="field">Your Gmail</label><input class="text" id="em" type="email" autocomplete="username" placeholder="name@gmail.com">
    <label class="field">PIN</label><input class="text" id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="4-digit PIN">
    <br><br><button class="btn" id="go" onclick="doLogin()">Sign in</button><div id="lerr"></div></div>`;
}

async function doLogin() {
  const email = document.getElementById('em').value.trim().toLowerCase();
  const pin = document.getElementById('pin').value.trim();
  const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Signing in…';
  const res = await loginCall(email, pin);
  if (res && res.ok && res.t) {
    S.session = {email: email, name: res.rep.name, u: res.u, t: res.t};
    await ffSet('session', S.session);
    S.view = 'due'; render(); await pullData(false);
  } else {
    btn.disabled = false; btn.textContent = 'Sign in';
    document.getElementById('lerr').innerHTML = `<div class="err">${res && res.error === 'auth' ? 'Wrong Gmail or PIN.' : 'Could not connect. Check internet and try again.'}</div>`;
  }
}

function startGeo() {
  if (!navigator.geolocation) return;
  stopGeo();
  S.geo = null;
  S.geoWatch = navigator.geolocation.watchPosition(p => {
    if (!S.geo || p.coords.accuracy < S.geo.accuracy) S.geo = {lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy)};
    const el = document.getElementById('geo'); if (el) el.innerHTML = geoText();
  }, err => { logClient('warn', 'geo', err.message); const el = document.getElementById('geo'); if (el) el.innerHTML = geoText(err.message); }, {enableHighAccuracy: true, maximumAge: 30000, timeout: 30000});
}
function stopGeo() { if (S.geoWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(S.geoWatch); S.geoWatch = null; }
function geoText(err) { return S.geo ? `📍 Location found (±${S.geo.accuracy} m)` : err ? `📍 Location not available: ${esc(err)}. Allow location for this app.` : '📍 Finding location…'; }

function openVisit(shopId) {
  S.showAllMissing = false;
  const shop = S.data.shops.find(s => s.shop_id === shopId);
  S.form = {
    visit_id: uid(), shop_id: shopId, opened_at: new Date().toISOString(), products: shop.products.slice(), add_products: [],
    count: {}, refill: {}, takeback: {}, what: [], takeback_reason: '', pay_mode: '', amount: '', utr: '', cheque_no: '', cheque_date: '',
    lines: {}, not_collected_reason: '', slip_no: '', slip_photo: '', shelf_photo: '', asked_by_name: '', issue: 'None', issue_note: '',
    count_override: false, refill_override: false
  };
  S.view = 'visit'; saveDraft(); startGeo(); render(); window.scrollTo(0, 0);
}

let draftTimer = null;
function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => ffSet('draft', S.form), 300); }

function shopOf(f) { return S.data.shops.find(s => s.shop_id === f.shop_id) || {}; }
function todayOf(f) { return (S.data.today || []).find(t => t.shop_id === f.shop_id) || {}; }
function has(f, a) { return f.what.indexOf(a) > -1; }
function slipNeeded(f) { return SLIP_ACTIONS.some(a => has(f, a)) || (has(f, 'Payment collected') && (f.pay_mode === 'Cash' || f.pay_mode === 'Cheque')); }
function openInvoices(f) {
  const pending = {};
  S.outbox.filter(o => o.type === 'visit').forEach(o => (o.payload.lines || []).forEach(l => { pending[l.invoice_no] = (pending[l.invoice_no] || 0) + Number(l.amount); }));
  return (S.data.invoices || []).filter(i => i.shop_id === f.shop_id).map(i => Object.assign({}, i, {balance: Math.round((i.balance - (pending[i.invoice_no] || 0)) * 100) / 100})).filter(i => i.balance > 0.009);
}
function lastAfter(f) {
  const q = S.outbox.filter(o => o.type === 'visit' && o.payload.shop_id === f.shop_id).sort((a, b) => b.created - a.created)[0];
  if (q) { const after = {}; Object.keys(q.payload.fields).forEach(k => { const m = k.match(/^count_(.+)$/); if (m && q.payload.fields[k] !== '') after[m[1]] = Number(q.payload.fields[k]) + (Number(q.payload.fields['refill_' + m[1]]) || 0) - (Number(q.payload.fields['takeback_' + m[1]]) || 0); }); return after; }
  return (S.data.last && S.data.last[f.shop_id] && S.data.last[f.shop_id].after) || null;
}
function countTooHigh(f) {
  const after = lastAfter(f); if (!after) return [];
  return f.products.filter(sku => f.count[sku] !== '' && f.count[sku] !== undefined && after[sku] !== undefined && Number(f.count[sku]) > after[sku]);
}
function usedSlips() { const s = (S.data.usedSlips || []).slice(); S.outbox.filter(o => o.type === 'visit' && o.payload.fields.slip_no !== '').forEach(o => s.push(Number(o.payload.fields.slip_no))); return s; }
function usedRefs() { const s = (S.data.usedRefs || []).slice(); S.outbox.filter(o => o.type === 'visit' && o.payload.fields.utr).forEach(o => s.push(String(o.payload.fields.utr))); return s; }
function myPads() { const p = (S.data.pads || []).slice(); S.outbox.filter(o => o.type === 'pad').forEach(o => p.push({first_no: Number(o.payload.first_no), last_no: Number(o.payload.last_no)})); return p; }

function validate(f) {
  const m = [];
  const today = todayOf(f);
  f.products.forEach(sku => { if (f.count[sku] === '' || f.count[sku] === undefined) m.push(productName(sku) + ' – shelf count'); });
  if (!f.what.length) m.push('What happened at this visit');
  if (has(f, 'Count only') && f.what.length > 1) m.push("'Count only' cannot be ticked with anything else");
  if (has(f, 'Payment collected') && has(f, 'Payment due not collected')) m.push('Tick either Payment collected or Payment due not collected, not both');
  if (has(f, 'Refilled') && !f.products.some(sku => Number(f.refill[sku]) > 0)) m.push('Refill quantity for at least one product');
  if (has(f, 'Packs taken back')) {
    if (!f.products.some(sku => Number(f.takeback[sku]) > 0)) m.push('Packs taken back – quantity');
    if (!f.takeback_reason) m.push('Why packs were taken back');
  }
  if (has(f, 'Payment collected')) {
    if (!f.pay_mode) m.push('How it was paid');
    if (!(Number(f.amount) > 0)) m.push('Amount collected');
    if (f.pay_mode === 'UPI' && !/^\d{12}$/.test(f.utr)) m.push('UPI reference – exactly 12 digits');
    if (f.pay_mode === 'Bank transfer' && String(f.utr).trim().length < 10) m.push('Bank reference – at least 10 characters');
    if ((f.pay_mode === 'UPI' || f.pay_mode === 'Bank transfer') && f.utr && usedRefs().indexOf(String(f.utr).trim()) > -1) m.push('This payment reference was already used on another visit');
    if (f.pay_mode === 'Cheque') {
      if (!f.cheque_no) m.push('Cheque number');
      if (!f.cheque_date) m.push('Date written on the cheque');
      else { const d = daysSince(f.cheque_date + 'T12:00:00+05:30'); if (d > 90 || d < -180) m.push('Cheque date must be within the last 3 months (or up to 6 months ahead)'); }
    }
    const inv = openInvoices(f);
    if (inv.length) {
      const lines = Object.keys(f.lines).map(k => f.lines[k]).filter(l => Number(l.amount) > 0);
      const total = lines.reduce((a, l) => a + Number(l.amount), 0);
      if (!lines.length) m.push('Payment split – enter the amount against each invoice paid');
      else if (Math.abs(total - Number(f.amount)) > 0.009) m.push('Payment split adds up to ' + money(total) + ' but amount collected is ' + money(f.amount || 0));
      lines.forEach(l => {
        const i = inv.find(x => x.invoice_no === l.invoice_no);
        if (i && Number(l.amount) > i.balance + 0.009) m.push(l.invoice_no + ': more than its balance ' + money(i.balance));
        if (i && Number(l.amount) < i.balance - 0.009) {
          if (!l.balance_reason) m.push(l.invoice_no + ': say what happens to the remaining ' + money(i.balance - Number(l.amount)));
          else if (l.balance_reason !== 'To be collected later' && !has(f, 'Packs taken back')) m.push(l.invoice_no + ': "' + l.balance_reason + '" needs Packs taken back ticked with the packs entered');
        }
      });
    }
  }
  if (has(f, 'Payment due not collected') && !f.not_collected_reason) m.push('Why payment was not collected');
  if (slipNeeded(f)) {
    const pads = myPads();
    if (!pads.length) m.push('No slip pad recorded for you yet – add your pad from the ☰ menu first');
    else if (!f.slip_no) m.push('Slip number');
    else {
      const n = Number(f.slip_no);
      if (!pads.some(p => n >= p.first_no && n <= p.last_no)) m.push('Slip number ' + n + ' is not in any of your pads');
      if (usedSlips().indexOf(n) > -1) m.push('Slip number ' + n + ' is already used – use the next slip');
    }
    if (!f.slip_photo) m.push('Photo of the signed slip');
  }
  if (!f.shelf_photo) m.push('Shelf photo');
  if (f.asked_by_name === '' || f.asked_by_name === undefined) m.push('Customers who asked for Friszon by name (0 if none)');
  if (f.issue && f.issue !== 'None' && !f.issue_note.trim()) m.push('Describe the issue');
  if (countTooHigh(f).length && !f.count_override) m.push('Count check: recount, or tick that the last visit\'s count was wrong');
  if (has(f, 'Refilled') && !has(f, 'Payment collected') && today.payment_overdue && !f.refill_override) m.push('Refill blocked: shop unpaid 60+ days – collect first, or tick Reporting Manager approved');
  return m;
}

function stepper(key, sku, val) {
  const blank = val === '' || val === undefined;
  return `<div class="stepper"><button onclick="step('${key}','${sku}',-1)">−</button><input inputmode="numeric" class="${blank ? 'blank' : ''}" value="${blank ? '' : esc(val)}" oninput="setNum('${key}','${sku}',this.value)"><button onclick="step('${key}','${sku}',1)">+</button></div>`;
}
function step(key, sku, d) { const f = S.form; const cur = key === 'asked' ? f.asked_by_name : f[key][sku]; let n = (cur === '' || cur === undefined ? 0 : Number(cur)) + d; if (cur === '' || cur === undefined) n = Math.max(0, d > 0 ? 1 : 0); n = Math.max(0, n); if (key === 'asked') f.asked_by_name = n; else f[key][sku] = n; saveDraft(); renderVisit(true); }
function setNum(key, sku, v) { const f = S.form; const val = v.replace(/[^0-9]/g, ''); const n = val === '' ? '' : Number(val); if (key === 'asked') f.asked_by_name = n; else f[key][sku] = n; saveDraft(); if (key === 'count') { const el = document.getElementById('countcheck'); if (el) el.innerHTML = countCheckHtml(f); } updateMissing(); }
function setF(k, v) { S.form[k] = v; saveDraft(); renderVisit(true); }
function setFQuiet(k, v) { S.form[k] = v; saveDraft(); updateMissing(); }
function toggleWhat(a) { const f = S.form; const i = f.what.indexOf(a); if (i > -1) f.what.splice(i, 1); else { if (a === 'Count only') f.what = []; else f.what = f.what.filter(x => x !== 'Count only'); f.what.push(a); } saveDraft(); renderVisit(true); }
function setLine(n, k, v) { const f = S.form; const i = openInvoices(f)[n]; if (!i) return; const inv = i.invoice_no; f.lines[inv] = f.lines[inv] || {invoice_no: inv, amount: '', balance_reason: ''}; f.lines[inv][k] = v; saveDraft(); if (k === 'amount') { const el = document.getElementById('rem-' + n); if (el) el.innerHTML = remHtml(i, f.lines[inv], n); } updateMissing(); }
function remHtml(i, l, n) { const a = Number(l.amount); if (!(a > 0 && a < i.balance - 0.009)) return ''; return `<label class="field">Remaining ${money(i.balance - a)} on this invoice is:</label><select onchange="setLine(${n},'balance_reason',this.value)"><option value="">Choose</option>${BALANCE_REASONS.map(r => `<option ${l.balance_reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`; }
function addProduct(sku, forRefill) { if (!sku) return; const f = S.form; if (f.products.indexOf(sku) < 0) { f.products.push(sku); f.add_products.push(sku); if (forRefill) { f.count[sku] = 0; f.refill[sku] = ''; } } saveDraft(); renderVisit(true); if (forRefill) toast(productName(sku) + ' added – enter the refill quantity'); }

async function takePhoto(field) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try { S.form[field] = await compress(file); saveDraft(); renderVisit(true); }
    catch (e) { logClient('error', 'photo', String(e)); toast('Photo failed. Try again.'); }
  };
  input.click();
}

function compress(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; } else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

function updateMissing() { const el = document.getElementById('missing'); if (!el) return; const m = validate(S.form); const shown = S.showAllMissing ? m : m.slice(0, 2); el.innerHTML = m.length ? 'Still needed: ' + shown.map(esc).join(' · ') + (m.length > shown.length ? ` <u onclick="S.showAllMissing=true;updateMissing()">+${m.length - shown.length} more</u>` : '') : ''; document.getElementById('savebtn').textContent = m.length ? 'Save visit (' + m.length + ' to fill)' : 'Save visit'; }

function renderVisit(keepScroll) {
  const y = window.scrollY;
  const f = S.form, shop = shopOf(f), t = todayOf(f);
  const others = (S.data.products || []).filter(p => f.products.indexOf(p.sku) < 0);
  const flags = (t.flag || '').split('|').map(x => x.trim()).filter(Boolean).map(x => `<span class="chip ${/Collect|overdue/i.test(x) ? 'red' : 'amber'}">${esc(x)}</span>`).join('');
  const inv = has(f, 'Payment collected') ? openInvoices(f) : [];
  let h = `<header class="top"${S.data.test ? ' style="background:#8a5a00"' : ''}><button onclick="cancelVisit()">←</button><h1>${esc(shop.shop_name)}</h1><span id="sync-status" class="status"></span></header><main>`;
  h += `<div class="card"><div class="small">${esc(shop.shop_id)}${t.amount_due ? ' · amount due ' + money(t.amount_due) : ''}</div><div class="small">${esc(t.refill_plan || '')}</div>${flags}<div class="small" id="geo" style="margin-top:8px">${geoText()}</div></div>`;
  h += `<div class="card"><h2>Packs on the shelf now</h2>${f.products.map(sku => `<div class="row"><div class="label">${esc(productName(sku))}</div>${stepper('count', sku, f.count[sku])}</div>`).join('')}
    ${others.length ? `<label class="field">Shop now keeps another product?</label><select onchange="addProduct(this.value)"><option value="">+ Add a product</option>${others.map(p => `<option value="${esc(p.sku)}">${esc(productName(p.sku))}</option>`).join('')}</select>` : ''}
    <div id="countcheck">${countCheckHtml(f)}</div></div>`;
  h += `<div class="card"><h2>What happened at this visit?</h2><div class="choices">${ACTIONS.map(a => `<button class="${has(f, a) ? 'on' : ''}" onclick="toggleWhat('${a}')">${a}</button>`).join('')}</div></div>`;
  if (has(f, 'Refilled')) {
    h += `<div class="card"><h2>Refill – packs added</h2>${f.products.map(sku => `<div class="row"><div class="label">${esc(productName(sku))}${f.add_products.indexOf(sku) > -1 ? '<small>New for this shop</small>' : ''}</div>${stepper('refill', sku, f.refill[sku])}</div>`).join('')}
      ${others.length ? `<label class="field">Refilling a product this shop never had?</label><select onchange="addProduct(this.value, true)"><option value="">+ Add a new product to refill</option>${others.map(p => `<option value="${esc(p.sku)}">${esc(productName(p.sku))}</option>`).join('')}</select>` : ''}`;
    if (!has(f, 'Payment collected') && t.payment_overdue) h += `<div class="err">This shop owes ${money(t.amount_due)} unpaid for 60+ days. Collect first.</div><label class="check"><input type="checkbox" ${f.refill_override ? 'checked' : ''} onchange="setF('refill_override',this.checked)"> My Reporting Manager approved this refill</label>`;
    h += `</div>`;
  }
  if (has(f, 'Packs taken back')) {
    h += `<div class="card"><h2>Packs taken back</h2>${f.products.map(sku => `<div class="row"><div class="label">${esc(productName(sku))}</div>${stepper('takeback', sku, f.takeback[sku])}</div>`).join('')}
      <label class="field">Why taken back?</label><select onchange="setF('takeback_reason',this.value)"><option value="">Choose</option>${TAKEBACK_REASONS.map(r => `<option ${f.takeback_reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`;
  }
  if (has(f, 'Payment collected')) {
    h += `<div class="card"><h2>Payment collected</h2><div class="choices">${PAY_MODES.map(p => `<button class="${f.pay_mode === p ? 'on' : ''}" onclick="setF('pay_mode','${p}')">${p}</button>`).join('')}</div>
      <label class="field">Amount collected (₹)</label><input class="text" inputmode="decimal" value="${esc(f.amount)}" oninput="setFQuiet('amount',this.value.replace(/[^0-9.]/g,''))">`;
    if (f.pay_mode === 'UPI' || f.pay_mode === 'Bank transfer') h += `<label class="field">${f.pay_mode === 'UPI' ? 'UPI reference (12 digits)' : 'Bank transfer UTR / reference'}</label><input class="text" ${f.pay_mode === 'UPI' ? 'inputmode="numeric"' : ''} value="${esc(f.utr)}" oninput="setFQuiet('utr',this.value.trim())">`;
    if (f.pay_mode === 'Cheque') h += `<label class="field">Cheque number</label><input class="text" inputmode="numeric" value="${esc(f.cheque_no)}" oninput="setFQuiet('cheque_no',this.value.trim())"><label class="field">Date written on the cheque</label><input class="text" type="date" value="${esc(f.cheque_date)}" onchange="setF('cheque_date',this.value)">`;
    if (inv.length) {
      h += `<label class="field">Split this payment across invoices</label>${inv.map((i, n) => { const l = f.lines[i.invoice_no] || {}; return `<div class="line"><div class="top"><span>${esc(i.label || i.invoice_no)}</span><span>balance ${money(i.balance)}</span></div><input class="text" inputmode="decimal" placeholder="Amount against this invoice" value="${esc(l.amount || '')}" oninput="setLine(${n},'amount',this.value.replace(/[^0-9.]/g,''))"><div id="rem-${n}">${remHtml(i, l, n)}</div></div>`; }).join('')}`;
    }
    h += `</div>`;
  }
  if (has(f, 'Payment due not collected')) h += `<div class="card"><h2>Why was payment not collected?</h2><select onchange="setF('not_collected_reason',this.value)"><option value="">Choose</option>${NOT_COLLECTED.map(r => `<option ${f.not_collected_reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`;
  if (slipNeeded(f)) {
    h += `<div class="card"><h2>Slip</h2>${myPads().length ? '' : '<div class="err">No slip pad recorded for you yet. Add your pad from the ☰ menu first.</div>'}<label class="field">Slip number (from your pad)</label><input class="text" inputmode="numeric" value="${esc(f.slip_no)}" oninput="setFQuiet('slip_no',this.value.replace(/[^0-9]/g,''))">
      <label class="field">Photo of the signed slip</label>${photoBlock('slip_photo')}</div>`;
  }
  h += `<div class="card"><h2>Shelf photo</h2><div class="small">All Friszon packs visible.</div><br>${photoBlock('shelf_photo')}</div>`;
  h += `<div class="card"><div class="row"><div class="label">Customers who asked for Friszon by name</div>${stepper('asked', '', f.asked_by_name)}</div>
    <label class="field">Any issue at this shop?</label><select onchange="setF('issue',this.value)">${ISSUES.map(r => `<option ${f.issue === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
    ${f.issue && f.issue !== 'None' ? `<label class="field">Describe the issue</label><textarea oninput="setFQuiet('issue_note',this.value)">${esc(f.issue_note)}</textarea>` : ''}</div>`;
  h += `</main><div class="savebar"><div class="inner"><div class="missing" id="missing"></div><button class="btn" id="savebtn" onclick="saveVisit()">Save visit</button></div></div>`;
  $app.innerHTML = h;
  renderHeaderStatus();
  updateMissing();
  if (keepScroll) window.scrollTo(0, y);
}

function countCheckHtml(f) {
  const tooHigh = countTooHigh(f);
  return tooHigh.length ? `<div class="warn">Count check: ${tooHigh.map(productName).map(esc).join(', ')} is higher than possible since the last visit. Recount and correct it.</div><label class="check"><input type="checkbox" ${f.count_override ? 'checked' : ''} onchange="setFQuiet('count_override',this.checked)"> The LAST visit's count was wrong (I have recounted)</label>` : '';
}

function photoBlock(field) {
  const v = S.form[field];
  return `<div class="photo">${v ? `<img src="${v}">` : ''}<button class="btn ${v ? 'ghost' : ''} small" onclick="takePhoto('${field}')">${v ? 'Retake photo' : 'Take photo'}</button></div>`;
}

async function cancelVisit() {
  if (!confirm('Leave this visit without saving? What you entered will be lost.')) return;
  stopGeo(); S.form = null; await ffSet('draft', null); S.view = 'due'; render();
}

async function saveVisit() {
  const f = S.form;
  const m = validate(f);
  if (m.length) { updateMissing(); document.getElementById('missing').scrollIntoView({behavior: 'smooth'}); toast('Fill the items listed in red first'); return; }
  const fields = {};
  (S.data.products || []).forEach(p => { fields['count_' + p.sku] = ''; fields['refill_' + p.sku] = ''; fields['takeback_' + p.sku] = ''; });
  f.products.forEach(sku => {
    fields['count_' + sku] = Number(f.count[sku]);
    if (has(f, 'Refilled')) fields['refill_' + sku] = f.refill[sku] === '' || f.refill[sku] === undefined ? '' : Number(f.refill[sku]);
    if (has(f, 'Packs taken back')) fields['takeback_' + sku] = f.takeback[sku] === '' || f.takeback[sku] === undefined ? '' : Number(f.takeback[sku]);
  });
  fields.what_happened = f.what.slice();
  fields.takeback_reason = has(f, 'Packs taken back') ? f.takeback_reason : '';
  const paid = has(f, 'Payment collected');
  fields.pay_mode = paid ? f.pay_mode : '';
  fields.amount = paid ? Number(f.amount) : '';
  fields.utr = paid && (f.pay_mode === 'UPI' || f.pay_mode === 'Bank transfer') ? String(f.utr) : '';
  fields.cheque_no = paid && f.pay_mode === 'Cheque' ? String(f.cheque_no) : '';
  fields.cheque_date = paid && f.pay_mode === 'Cheque' ? f.cheque_date : '';
  fields.not_collected_reason = has(f, 'Payment due not collected') ? f.not_collected_reason : '';
  fields.slip_no = slipNeeded(f) ? Number(f.slip_no) : '';
  fields.asked_by_name = Number(f.asked_by_name);
  fields.issue = f.issue || 'None';
  fields.issue_note = f.issue !== 'None' ? f.issue_note : '';
  fields.count_override = !!f.count_override && countTooHigh(f).length > 0;
  fields.refill_override = !!f.refill_override;
  const lines = paid ? Object.keys(f.lines).map(k => f.lines[k]).filter(l => Number(l.amount) > 0).map(l => ({invoice_no: l.invoice_no, amount: Number(l.amount), balance_reason: l.balance_reason || ''})) : [];
  const g = S.geo;
  const payload = {
    visit_id: f.visit_id, shop_id: f.shop_id, visit_time: f.opened_at, saved_at: new Date().toISOString(),
    gps: g ? g.lat.toFixed(6) + ', ' + g.lng.toFixed(6) : '0.000000, 0.000000', gps_accuracy: g ? g.accuracy : '',
    fields: fields, lines: lines, add_products: f.add_products, shelf_photo: f.shelf_photo, slip_photo: slipNeeded(f) ? f.slip_photo : '', app_version: APP_VERSION
  };
  const shop = shopOf(f);
  await ffOutboxPut({id: f.visit_id, type: 'visit', payload: payload, created: Date.now(), label: shop.shop_name + ' – ' + f.what.join(', ')});
  if (f.add_products.length) { shop.products = f.products.slice(); await ffSet('data', S.data); }
  stopGeo();
  S.form = null; await ffSet('draft', null);
  await refreshOutbox();
  S.view = 'due'; render(); window.scrollTo(0, 0);
  toast('Saved on phone ✓ Sending…');
  await syncNow();
  S.sentLog = (await ffGet('sentLog')) || [];
  render();
  toast(S.outbox.length ? 'Saved ✓ Will send when signal is back' : 'Saved and sent ✓');
}

function renderPad() {
  const p = S.pad;
  $app.innerHTML = `<header class="top"><button onclick="S.view='due';render()">←</button><h1>Add slip pad</h1><span id="sync-status" class="status"></span></header><main>
    <div class="card"><label class="field">First slip number in this pad</label><input class="text" inputmode="numeric" value="${esc(p.first_no)}" oninput="S.pad.first_no=this.value.replace(/[^0-9]/g,'')">
    <label class="field">Last slip number in this pad</label><input class="text" inputmode="numeric" value="${esc(p.last_no)}" oninput="S.pad.last_no=this.value.replace(/[^0-9]/g,'')">
    <label class="field">Photo of the first slip (number clearly visible)</label><div class="photo">${p.photo ? `<img src="${p.photo}">` : ''}<button class="btn small ${p.photo ? 'ghost' : ''}" onclick="padPhoto()">${p.photo ? 'Retake photo' : 'Take photo'}</button></div>
    <div id="perr"></div><br><button class="btn" onclick="savePad()">Save pad</button></div></main>`;
  renderHeaderStatus();
}

function padPhoto() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => { const file = input.files && input.files[0]; if (!file) return; S.pad.photo = await compress(file); renderPad(); };
  input.click();
}

async function savePad() {
  const p = S.pad, a = Number(p.first_no), b = Number(p.last_no);
  let err = '';
  if (!p.first_no || !p.last_no) err = 'Enter the first and last slip numbers.';
  else if (!(b > a)) err = 'Last number must be above the first.';
  else if (myPads().some(x => x.first_no <= b && x.last_no >= a)) err = 'This pad overlaps a pad you already have.';
  else if (!p.photo) err = 'Take a photo of the first slip.';
  if (err) { document.getElementById('perr').innerHTML = `<div class="err">${err}</div>`; return; }
  await ffOutboxPut({id: p.pad_id, type: 'pad', payload: {pad_id: p.pad_id, first_no: a, last_no: b, photo: p.photo, saved_at: new Date().toISOString()}, created: Date.now(), label: 'Slip pad ' + a + '–' + b});
  await refreshOutbox();
  S.view = 'due'; render(); toast('Pad saved ✓');
  syncNow();
}

(async () => { S.sentLog = (await ffGet('sentLog')) || []; init(); })();
