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
    try { return JSON.parse(text); } catch (e) { return {ok: false, error: 'bad_response', detail: text.slice(0, 200)}; }
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
    try { return JSON.parse(text); } catch (e) { return {ok: false, error: 'bad_response', detail: text.slice(0, 200)}; }
  } finally {
    clearTimeout(t);
  }
}

function ffCred(session) {
  return {u: session.u, t: session.t};
}

let ffSyncing = false;

async function ffSyncOutbox(onProgress) {
  if (ffSyncing) return {busy: true};
  ffSyncing = true;
  let sent = 0, failed = 0;
  try {
    const session = await ffGet('session');
    if (!session || !session.t) return {sent: 0, failed: 0};
    const items = (await ffOutboxAll()).sort((a, b) => a.created - b.created);
    for (const item of items) {
      if (item.type === 'prospect' && item.payload.stage !== 'f1' && items.some(x => x.type === 'prospect' && x.permanent && x.payload.prospect_id === item.payload.prospect_id && x.id !== item.id)) {
        if (!item.permanent) { item.permanent = true; item.lastError = 'bad_prospect: Form 1 of this shop was rejected'; await ffOutboxPut(item); }
        failed++;
        continue;
      }
      item.attempts = (item.attempts || 0) + 1;
      item.lastTry = Date.now();
      let res;
      try {
        const payload = Object.assign({}, item.payload, {attempts: item.attempts});
        const body = Object.assign({op: item.type}, ffCred(session));
        body[item.type] = payload;
        const id = payload.visit_id || payload.pad_id || payload.dayclose_id || payload.deposit_id || payload.receipt_id || payload.monthclose_id || (payload.prospect_id ? payload.prospect_id + '.' + payload.stage : '') || '';
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
          prospect: item.type === 'prospect' && pl.stage === 'f1' ? {prospect_id: pl.prospect_id, shop_name: pl.shop_name, pincode: pl.pincode, created_at: pl.saved_at, q8_community: (pl.answers || {}).q8_community || '', q9_shop_type: (pl.answers || {}).q9_shop_type || '', stop: !!pl.stop} : null});
        await ffSet('sentLog', sentLog.slice(0, 200));
        sent++;
      } else {
        item.lastError = (res && (res.error + (res.detail ? ': ' + res.detail : ''))) || 'unknown';
        item.permanent = !!(res && ['not_your_shop', 'bad_visit', 'bad_pad', 'pad_range', 'pad_overlap', 'bad_dayclose', 'dayclose_exists', 'bad_deposit', 'bad_receipt', 'receipt_exists', 'bad_monthclose', 'monthclose_exists', 'bad_prospect'].indexOf(res.error) > -1);
        await ffOutboxPut(item);
        failed++;
        if (!item.permanent) break;
      }
      if (onProgress) onProgress();
    }
  } finally {
    ffSyncing = false;
  }
  return {sent: sent, failed: failed};
}
