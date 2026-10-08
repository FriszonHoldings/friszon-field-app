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
      item.attempts = (item.attempts || 0) + 1;
      item.lastTry = Date.now();
      let res;
      try {
        const payload = Object.assign({}, item.payload, {attempts: item.attempts});
        const body = Object.assign({op: item.type}, ffCred(session));
        body[item.type] = payload;
        const id = item.type === 'visit' ? payload.visit_id : item.type === 'pad' ? payload.pad_id : '';
        const once = () => ffApi(body, 40000, id).catch(e => ({ok: false, error: 'network', detail: String(e && e.message || e)}));
        res = await once();
        if (res && ['retry', 'bad_response', 'network'].indexOf(res.error) > -1) res = await once();
      } catch (e) {
        res = {ok: false, error: 'network', detail: String(e && e.message || e)};
      }
      if (res && res.ok) {
        await ffOutboxDelete(item.id);
        const sentLog = (await ffGet('sentLog')) || [];
        sentLog.unshift({id: item.id, type: item.type, shop_id: item.payload.shop_id || '', label: item.label || '', saved_at: item.created, sent_at: Date.now()});
        await ffSet('sentLog', sentLog.slice(0, 200));
        sent++;
      } else {
        item.lastError = (res && (res.error + (res.detail ? ': ' + res.detail : ''))) || 'unknown';
        item.permanent = !!(res && ['not_your_shop', 'bad_visit', 'bad_pad', 'pad_range', 'pad_overlap'].indexOf(res.error) > -1);
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
