const FF_API_URL = 'https://script.google.com/macros/s/AKfycbytE1QRjXO9ZbLY5zU_6-0pNkrYB4fQxiqMdnY6pwcYxYkHZdKdHnt0b9yLDdgEpRh8Jg/exec';
const FF_DB = 'friszon-field';
const FF_DB_VERSION = 1;

function ffOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FF_DB, FF_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', {keyPath: 'id'});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ffTx(store, mode, fn) {
  const db = await ffOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const st = tx.objectStore(store);
    let result;
    Promise.resolve(fn(st)).then(r => { result = r; });
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

function ffReq(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

async function ffGet(key) { return ffTx('kv', 'readonly', st => ffReq(st.get(key))); }
async function ffSet(key, val) { return ffTx('kv', 'readwrite', st => ffReq(st.put(val, key))); }
async function ffOutboxAll() { return ffTx('outbox', 'readonly', st => ffReq(st.getAll())); }
async function ffOutboxPut(item) { return ffTx('outbox', 'readwrite', st => ffReq(st.put(item))); }
async function ffOutboxDelete(id) { return ffTx('outbox', 'readwrite', st => ffReq(st.delete(id))); }

// Every call to the office is noted on the phone: the time of the last answer, and a short list of calls that failed.
async function ffNet(op, err) {
  try {
    if (!err) { await ffSet('lastContact', Date.now()); return; }
    const n = (await ffGet('netLog')) || [];
    n.push({at: Date.now(), op: String(op || ''), err: String(err).slice(0, 80)});
    await ffSet('netLog', n.slice(-30));
  } catch (e) {}
}

function ffQuery(params) {
  return Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
}

async function ffApi(body, timeoutMs, id) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  try {
    const url = FF_API_URL + '?' + ffQuery({op: body.op, id: id, u: body.u, t: body.t});
    const res = await fetch(url, {method: 'POST', body: JSON.stringify(body), headers: {'Content-Type': 'text/plain;charset=utf-8'}, signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store'});
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); } catch (e) { out = {ok: false, error: 'bad_response', detail: text.slice(0, 200)}; }
    await ffNet(body.op, out.error === 'bad_response' ? 'bad_response' : '');
    return out;
  } catch (e) {
    await ffNet(body.op, 'network: ' + String(e && e.message || e));
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function ffGetApi(params, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  try {
    const url = FF_API_URL + '?' + ffQuery(Object.assign({}, params, {n: Date.now().toString(36)}));
    const res = await fetch(url, {method: 'GET', signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store'});
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); } catch (e) { out = {ok: false, error: 'bad_response', detail: text.slice(0, 200)}; }
    await ffNet(params.op, out.error === 'bad_response' ? 'bad_response' : '');
    return out;
  } catch (e) {
    await ffNet(params.op, 'network: ' + String(e && e.message || e));
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function ffCred(session) {
  return {u: session.u, t: session.t};
}

let ffSyncing = false;
const FF_LOCK_MS = 120000;
const FF_PERM_RETRY_MS = 30 * 60000;
const ffLockId = Math.random().toString(36).slice(2);

// One sender at a time across the page and the service worker, so the same item is never posted twice at once.
async function ffLock(take) {
  const db = await ffOpenDb();
  return new Promise(resolve => {
    let got = false;
    const tx = db.transaction('kv', 'readwrite');
    const st = tx.objectStore('kv');
    const r = st.get('syncLock');
    r.onsuccess = () => {
      const cur = r.result, now = Date.now();
      const free = !cur || cur.until < now || cur.by === ffLockId;
      if (take && free) { st.put({by: ffLockId, until: now + FF_LOCK_MS}, 'syncLock'); got = true; }
      if (!take && cur && cur.by === ffLockId) st.delete('syncLock');
    };
    tx.oncomplete = () => { db.close(); resolve(got); };
    tx.onerror = tx.onabort = () => { db.close(); resolve(false); };
  });
}

function ffDayKey(iso) {
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

// A rejected attendance entry that can never go through from the phone: already recorded, or a mark-in for a day that is over.
function ffDeadAtt(item, sentLog) {
  if (item.type !== 'att' || !item.permanent) return false;
  if (/^att_exists/.test(item.lastError || '')) return true;
  const pl = item.payload || {}, day = ffDayKey(pl.event_time);
  if (pl.kind === 'IN' && day < ffDayKey(new Date().toISOString())) return true;
  return (sentLog || []).some(x => x.type === 'att' && x.att && x.att.kind === pl.kind && ffDayKey(x.att.event_time) === day && x.att.att_id !== pl.att_id);
}

async function ffSyncOutbox(onProgress) {
  if (ffSyncing) return {busy: true};
  ffSyncing = true;
  let sent = 0, failed = 0, locked = false;
  try {
    const session = await ffGet('session');
    if (!session || !session.t) return {sent: 0, failed: 0};
    locked = await ffLock(true);
    if (!locked) return {busy: true};
    const items = (await ffOutboxAll()).sort((a, b) => a.created - b.created);
    const sentBefore = (await ffGet('sentLog')) || [];
    for (const item of items) {
      if (ffDeadAtt(item, sentBefore)) {
        await ffOutboxDelete(item.id);
        const dropped = (await ffGet('droppedLog')) || [];
        dropped.unshift({id: item.id, type: item.type, label: item.label || '', error: item.lastError || '', attempts: item.attempts || 0, payload: Object.assign({}, item.payload, {selfie: ''}), dropped_at: Date.now()});
        await ffSet('droppedLog', dropped.slice(0, 50));
        if (onProgress) onProgress();
        continue;
      }
      if (item.permanent && Date.now() - (item.lastTry || 0) < FF_PERM_RETRY_MS) { failed++; continue; }
      await ffLock(true);
      if (item.type === 'prospect' && item.payload.stage !== 'f1' && items.some(x => x.type === 'prospect' && x.permanent && x.payload.prospect_id === item.payload.prospect_id && x.id !== item.id)) {
        if (!item.permanent) { item.permanent = true; item.lastError = 'bad_prospect: Form 1 of this shop was rejected'; await ffOutboxPut(item); }
        failed++;
        continue;
      }
      item.attempts = (item.attempts || 0) + 1;
      item.lastTry = Date.now();
      let res;
      try {
        const payload = Object.assign({}, item.payload, {attempts: item.attempts, sent_at: new Date().toISOString()});
        const body = Object.assign({op: item.type}, ffCred(session));
        body[item.type] = payload;
        const id = payload.visit_id || payload.pad_id || payload.dayclose_id || payload.deposit_id || payload.receipt_id || payload.monthclose_id || payload.att_id || (payload.prospect_id ? payload.prospect_id + '.' + payload.stage : '') || '';
        const once = () => ffApi(body, 40000, id).catch(e => ({ok: false, error: 'network', detail: String(e && e.message || e)}));
        res = await once();
        if (res && ['retry', 'bad_response', 'network'].indexOf(res.error) > -1) res = await once();
      } catch (e) {
        res = {ok: false, error: 'network', detail: String(e && e.message || e)};
      }
      if (res && res.ok) {
        await ffOutboxDelete(item.id);
        const sentLog = (await ffGet('sentLog')) || [];
        const pl = item.payload || {}, fl = pl.fields || {};
        sentLog.unshift({id: item.id, type: item.type, shop_id: pl.shop_id || '', label: item.label || '', saved_at: item.created, sent_at: Date.now(),
          visit_time: pl.visit_time || '', pay_mode: fl.pay_mode || '', amount: fl.amount || 0, paid: (fl.what_happened || []).indexOf('Payment collected') > -1, cheque_date: fl.cheque_date || '', slip_no: fl.slip_no || '', deliver_pending: fl.deliver_pending || '', v2: fl.delivery !== undefined,
          collections: pl.collections || [], close_date: pl.close_date || '', dispatch_id: pl.dispatch_id || '', month: pl.month || '', prospect_id: pl.prospect_id || '', stage: pl.stage || '',
          prospect: item.type === 'prospect' && pl.stage === 'f1' ? {prospect_id: pl.prospect_id, shop_name: pl.shop_name, pincode: pl.pincode, created_at: pl.saved_at, q8_community: (pl.answers || {}).q8_community || '', q9_shop_type: (pl.answers || {}).q9_shop_type || '', stop: !!pl.stop} : null,
          att: item.type === 'att' ? {att_id: pl.att_id, kind: pl.kind, event_time: pl.event_time, reason: pl.reason || '', status: res.status || (pl.reason || pl.missed_reason ? 'Pending' : 'OK'), decision_note: ''} : null});
        await ffSet('sentLog', sentLog.slice(0, 200));
        sent++;
      } else {
        item.lastError = (res && (res.error + (res.detail ? ': ' + res.detail : ''))) || 'unknown';
        item.permanent = !!(res && ['not_your_shop', 'bad_visit', 'bad_pad', 'pad_range', 'pad_overlap', 'bad_dayclose', 'dayclose_exists', 'bad_deposit', 'bad_receipt', 'receipt_exists', 'bad_monthclose', 'monthclose_exists', 'bad_prospect', 'bad_att', 'att_exists'].indexOf(res.error) > -1);
        await ffOutboxPut(item);
        failed++;
        if (!item.permanent) break;
      }
      if (onProgress) onProgress();
    }
  } finally {
    if (locked) await ffLock(false);
    ffSyncing = false;
  }
  return {sent: sent, failed: failed};
}
