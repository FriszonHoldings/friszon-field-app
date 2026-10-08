const API_VERSION = '1.4.0';
const FIELD_ID = '1pwInjVDR229K2t6yY2uYpXnWzZtDN08zn2yAQAR5J10';
const APP_FOLDER_PATH = ['appsheet', 'data', 'FriszonField-614282017'];
const TZ = 'Asia/Kolkata';
const SLIP_ACTIONS = ['Refilled', 'Monthly confirmation', 'Packs taken back'];

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  if (!p.op) return out_({ok: false, error: 'retry', via: 'get'});
  return handle_(p);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ok: false, error: 'bad_json'}); }
  return handle_(body);
}

let PROF_ = [];
let PROF_T_ = 0;
function mark_(label) { const n = Date.now(); PROF_.push(label + ':' + (n - PROF_T_)); PROF_T_ = n; }

function handle_(req) {
  const started = Date.now();
  PROF_ = []; PROF_T_ = started;
  try {
    if (req.op === 'ping') return out_({ok: true, version: API_VERSION, now: new Date().toISOString()});
    if (!req.email || !req.pin) return out_({ok: false, error: 'retry', via: 'no_credentials'});
    const rep = auth_(req);
    mark_('auth');
    if (!rep) return out_({ok: false, error: 'auth'});
    let res;
    if (req.op === 'login') res = {ok: true, rep: rep};
    else if (req.op === 'bootstrap') res = bootstrap_(rep);
    else if (req.op === 'visit') res = saveVisit_(rep, req.visit);
    else if (req.op === 'pad') res = savePad_(rep, req.pad);
    else if (req.op === 'log') res = saveLog_(rep, req.entries || []);
    else res = {ok: false, error: 'unknown_op'};
    res.ms = Date.now() - started;
    res.prof = PROF_.join(' ');
    return out_(res);
  } catch (err) {
    try { serverError_(req, err); } catch (e2) {}
    return out_({ok: false, error: 'server', detail: String(err && err.message || err)});
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const pin = String(req.pin || '').trim();
  if (!email || !pin) return null;
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + email;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 8) return null;
  const props = PropertiesService.getScriptProperties();
  const pins = JSON.parse(props.getProperty('PINS') || '{}');
  if (!pins[email] || String(pins[email]) !== pin) {
    cache.put(failKey, String(fails + 1), 900);
    return null;
  }
  const testLogins = JSON.parse(props.getProperty('TEST_LOGINS') || '{}');
  const target = testLogins[email] ? String(testLogins[email]).trim().toLowerCase() : email;
  const repKey = 'rep_' + target;
  let r = null;
  const hit = cache.get(repKey);
  if (hit) r = JSON.parse(hit);
  else {
    const reps = table_(ss_().getSheetByName('APP_Reps'));
    r = reps.rows.find(x => String(x.rep_email).trim().toLowerCase() === target) || null;
    if (r) cache.put(repKey, JSON.stringify({name: String(r.name || ''), city: String(r.city || '')}), 21600);
  }
  if (!r) return null;
  if (testLogins[email]) return {email: target, name: 'TEST ' + String(r.name || ''), city: String(r.city || ''), test: true, login: email};
  return {email: target, name: String(r.name || ''), city: String(r.city || '')};
}

function sheet_(ss, rep, name) {
  if (!rep.test) return ss.getSheetByName(name);
  const tname = 'TEST_' + name;
  let sh = ss.getSheetByName(tname);
  if (!sh) {
    const src = ss.getSheetByName(name);
    sh = ss.insertSheet(tname);
    if (src) sh.getRange(1, 1, 1, src.getLastColumn()).setValues(src.getRange(1, 1, 1, src.getLastColumn()).getValues());
  }
  return sh;
}

function rowsBoth_(ss, rep, name) {
  const rows = table_(ss.getSheetByName(name)).rows;
  if (!rep.test) return rows;
  const t = ss.getSheetByName('TEST_' + name);
  return t && t.getLastRow() > 1 ? rows.concat(table_(t).rows) : rows;
}

function ss_() {
  return SpreadsheetApp.openById(FIELD_ID);
}

function table_(sheet) {
  const v = sheet.getDataRange().getValues();
  const head = v.shift().map(h => String(h).trim());
  const rows = v.filter(r => r.some(c => c !== '' && c !== null)).map(r => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = r[i]; });
    return o;
  });
  return {head: head, rows: rows};
}

function iso_(d) {
  return d instanceof Date ? d.toISOString() : (d === null || d === undefined ? '' : d);
}

function list_(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function bootstrap_(rep) {
  const ss = ss_();
  const me = rep.email;
  const shops = table_(ss.getSheetByName('APP_Shops')).rows
    .filter(s => String(s.rep_email).trim().toLowerCase() === me)
    .map(s => ({
      shop_id: String(s.shop_id), shop_name: String(s.shop_name), status: String(s.status),
      products: list_(s.products_stocked), owner_name: String(s.owner_name || ''),
      owner_mobile: String(s.owner_mobile || ''), pincode: String(s.pincode || '')
    }));
  const myShopIds = {};
  shops.forEach(s => { myShopIds[s.shop_id] = true; });
  const today = table_(ss.getSheetByName('APP_Today')).rows
    .filter(t => myShopIds[String(t.shop_id)])
    .map(t => ({
      shop_id: String(t.shop_id), amount_due: Number(t.amount_due) || 0, refill_plan: String(t.refill_plan || ''),
      monthly_confirmation_due: t.monthly_confirmation_due === true || String(t.monthly_confirmation_due).toUpperCase() === 'TRUE',
      payment_overdue: t.payment_overdue === true || String(t.payment_overdue).toUpperCase() === 'TRUE',
      last_visit: iso_(t.last_visit), flag: String(t.flag || '')
    }));
  const products = table_(ss.getSheetByName('APP_Products')).rows
    .filter(p => String(p.active).toUpperCase().indexOf('Y') === 0 || p.active === true)
    .map(p => ({sku: String(p.sku), name: String(p.name), pack: String(p.pack || '')}));
  const invoices = table_(ss.getSheetByName('APP_Invoices')).rows
    .filter(i => myShopIds[String(i.shop_id)] && ['Open', 'Awaiting approval'].indexOf(String(i.status)) > -1)
    .map(i => ({invoice_no: String(i.invoice_no), shop_id: String(i.shop_id), inv_date: iso_(i.inv_date), balance: Number(i.balance) || 0, label: String(i.label || i.invoice_no)}));
  const visitsT = {rows: rowsBoth_(ss, rep, 'APP_Visits')};
  const lastByShop = {};
  const usedSlips = [];
  const usedRefs = [];
  visitsT.rows.forEach(v => {
    const sid = String(v.shop_id);
    if (v.utr !== '' && v.utr !== null) usedRefs.push(String(v.utr));
    if (String(v.rep_email).trim().toLowerCase() === me && v.slip_no !== '' && v.slip_no !== null) usedSlips.push(Number(v.slip_no));
    if (!myShopIds[sid]) return;
    const t = v.visit_time instanceof Date ? v.visit_time.getTime() : 0;
    if (!lastByShop[sid] || t > lastByShop[sid].t) lastByShop[sid] = {t: t, v: v};
  });
  const last = {};
  Object.keys(lastByShop).forEach(sid => {
    const v = lastByShop[sid].v;
    const after = {};
    Object.keys(v).forEach(k => {
      const m = k.match(/^count_(.+)$/);
      if (!m) return;
      const sku = m[1];
      if (v[k] === '' || v[k] === null) return;
      after[sku] = (Number(v[k]) || 0) + (Number(v['refill_' + sku]) || 0) - (Number(v['takeback_' + sku]) || 0);
    });
    last[sid] = {visit_time: iso_(v.visit_time), after: after};
  });
  const pads = rowsBoth_(ss, rep, 'APP_SlipPads')
    .filter(p => String(p.rep_email).trim().toLowerCase() === me)
    .map(p => ({pad_id: String(p.pad_id), first_no: Number(p.first_no), last_no: Number(p.last_no)}));
  const todayKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const visitedToday = visitsT.rows
    .filter(v => String(v.rep_email).trim().toLowerCase() === me && v.visit_time instanceof Date && Utilities.formatDate(v.visit_time, TZ, 'yyyy-MM-dd') === todayKey)
    .map(v => ({visit_id: String(v.visit_id), shop_id: String(v.shop_id), visit_time: iso_(v.visit_time)}));
  return {
    ok: true, version: API_VERSION, now: new Date().toISOString(), rep: rep, test: !!rep.test, shops: shops, today: today,
    products: products, invoices: invoices, last: last, pads: pads, usedSlips: usedSlips, usedRefs: usedRefs, visitedToday: visitedToday
  };
}

function folder_(name) {
  const props = PropertiesService.getScriptProperties();
  const key = 'FOLDER_' + name;
  const id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  let f = null;
  let it = DriveApp.getFoldersByName(APP_FOLDER_PATH[0]);
  if (!it.hasNext()) throw new Error('appsheet folder missing');
  f = it.next();
  for (let i = 1; i < APP_FOLDER_PATH.length; i++) {
    it = f.getFoldersByName(APP_FOLDER_PATH[i]);
    if (!it.hasNext()) throw new Error('folder missing: ' + APP_FOLDER_PATH[i]);
    f = it.next();
  }
  it = f.getFoldersByName(name);
  const target = it.hasNext() ? it.next() : f.createFolder(name);
  props.setProperty(key, target.getId());
  return target;
}

function photoPath_(rep, folderName, recordId, column) {
  return (rep && rep.test ? 'TEST_' : '') + folderName + '/' + recordId + '.' + column + '.jpg';
}

function visitPhotos_(rep, v) {
  if (v.shelf_photo) savePhoto_('APP_Visits_Images', v.visit_id, 'shelf_photo', v.shelf_photo, rep);
  if (v.slip_photo) savePhoto_('APP_Visits_Images', v.visit_id, 'slip_photo', v.slip_photo, rep);
}

function savePhoto_(folderName, recordId, column, dataUrl, rep) {
  if (!dataUrl) return '';
  if (rep && rep.test) return savePhoto_('TEST_' + folderName, recordId, column, dataUrl);
  const m = String(dataUrl).match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) throw new Error('bad photo for ' + column);
  const name = recordId + '.' + column + '.jpg';
  const folder = folder_(folderName);
  const existing = folder.getFilesByName(name);
  if (!existing.hasNext()) folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name));
  return folderName + '/' + name;
}

function saveVisit_(rep, v) {
  if (!v || !v.visit_id || !v.shop_id) return {ok: false, error: 'bad_visit'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_Visits');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
  mark_('ids');
  if (ids.indexOf(String(v.visit_id)) > -1) { visitPhotos_(rep, v); return {ok: true, duplicate: true, visit_id: v.visit_id}; }
  const shopSh = ss.getSheetByName('APP_Shops');
  const sv = shopSh.getDataRange().getValues();
  const sh0 = sv[0].map(h => String(h).trim());
  const si = sh0.indexOf('shop_id'), ri = sh0.indexOf('rep_email');
  const shopRow = sv.find((r, k) => k > 0 && String(r[si]) === String(v.shop_id));
  if (!shopRow || String(shopRow[ri]).trim().toLowerCase() !== rep.email) return {ok: false, error: 'not_your_shop'};
  mark_('shop');
  const shelf = v.shelf_photo ? photoPath_(rep, 'APP_Visits_Images', v.visit_id, 'shelf_photo') : '';
  const slip = v.slip_photo ? photoPath_(rep, 'APP_Visits_Images', v.visit_id, 'slip_photo') : '';
  const f = v.fields || {};
  const row = head.map(h => {
    if (h === 'visit_id') return v.visit_id;
    if (h === 'shop_id') return v.shop_id;
    if (h === 'rep_email') return rep.email;
    if (h === 'visit_time') return new Date(v.visit_time);
    if (h === 'gps') return v.gps || '0.000000, 0.000000';
    if (h === 'shelf_photo') return shelf;
    if (h === 'slip_photo') return slip;
    if (h === 'what_happened') return (f.what_happened || []).join(' , ');
    if (h === 'cheque_date') return f.cheque_date ? new Date(f.cheque_date + 'T00:00:00+05:30') : new Date(v.visit_time);
    if (h === 'spot_check') return false;
    if (h === 'count_override' || h === 'refill_override') return f[h] ? true : '';
    if (h === 'invoices_paid') return (v.lines || []).map(l => l.invoice_no).join(' , ');
    if (Object.prototype.hasOwnProperty.call(f, h)) return f[h] === null || f[h] === undefined ? '' : f[h];
    return '';
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  mark_('lock');
  try {
    const again = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    if (again.indexOf(String(v.visit_id)) > -1) return {ok: true, duplicate: true, visit_id: v.visit_id};
    sh.appendRow(row);
    const pl = sheet_(ss, rep, 'APP_PaymentLines');
    const plHead = pl.getRange(1, 1, 1, pl.getLastColumn()).getValues()[0].map(h => String(h).trim());
    (v.lines || []).forEach((l, i) => {
      const o = {line_id: v.visit_id + '-' + (i + 1), visit_id: v.visit_id, invoice_no: l.invoice_no, amount: Number(l.amount), rep_email: rep.email, created_at: new Date(v.saved_at || v.visit_time), balance_reason: l.balance_reason || ''};
      pl.appendRow(plHead.map(h => Object.prototype.hasOwnProperty.call(o, h) ? o[h] : ''));
    });
    if (v.add_products && v.add_products.length && !rep.test) {
      const ssh = ss.getSheetByName('APP_Shops');
      const sHead = ssh.getRange(1, 1, 1, ssh.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const idCol = sHead.indexOf('shop_id');
      const pCol = sHead.indexOf('products_stocked');
      const idsS = ssh.getRange(2, idCol + 1, ssh.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
      const r = idsS.indexOf(String(v.shop_id));
      if (r > -1) {
        const cell = ssh.getRange(r + 2, pCol + 1);
        const cur = list_(cell.getValue());
        v.add_products.forEach(sku => { if (cur.indexOf(sku) < 0) cur.push(sku); });
        cell.setValue(cur.join(' , '));
      }
    }
    mark_('write');
    syncLog_(ss, rep, v);
    mark_('log');
  } finally {
    lock.releaseLock();
  }
  visitPhotos_(rep, v);
  mark_('photos');
  return {ok: true, visit_id: v.visit_id};
}

function syncLog_(ss, rep, v) {
  const name = rep.test ? 'TEST_SyncLog' : 'APP_SyncLog';
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(['visit_id', 'rep_email', 'shop_id', 'opened_at', 'saved_at', 'received_at', 'delay_sec', 'gps_accuracy_m', 'app_version', 'attempts']);
  }
  const saved = v.saved_at ? new Date(v.saved_at) : null;
  const now = new Date();
  sh.appendRow([v.visit_id, rep.email, v.shop_id, new Date(v.visit_time), saved || '', now, saved ? Math.round((now - saved) / 1000) : '', v.gps_accuracy || '', v.app_version || '', v.attempts || 1]);
}

function savePad_(rep, p) {
  if (!p || !p.pad_id) return {ok: false, error: 'bad_pad'};
  const first = Number(p.first_no), last = Number(p.last_no);
  if (!(last > first)) return {ok: false, error: 'pad_range'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_SlipPads');
  const t = table_(sh);
  if (t.rows.some(r => String(r.pad_id) === String(p.pad_id))) return {ok: true, duplicate: true};
  const clash = t.rows.find(r => String(r.rep_email).trim().toLowerCase() === rep.email && Number(r.first_no) <= last && Number(r.last_no) >= first);
  if (clash) return {ok: false, error: 'pad_overlap'};
  const photo = savePhoto_('APP_SlipPads_Images', p.pad_id, 'first_slip_photo', p.photo, rep);
  const o = {pad_id: p.pad_id, rep_email: rep.email, first_no: first, last_no: last, first_slip_photo: photo, received_time: new Date(p.saved_at || Date.now())};
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { sh.appendRow(t.head.map(h => Object.prototype.hasOwnProperty.call(o, h) ? o[h] : '')); } finally { lock.releaseLock(); }
  return {ok: true, pad_id: p.pad_id};
}

function saveLog_(rep, entries) {
  const ss = ss_();
  let sh = ss.getSheetByName('APP_ClientLog');
  if (!sh) { sh = ss.insertSheet('APP_ClientLog'); sh.appendRow(['received_at', 'rep_email', 'at', 'level', 'message', 'detail']); }
  const now = new Date();
  entries.slice(0, 50).forEach(e => sh.appendRow([now, rep.email, e.at || '', e.level || 'info', String(e.message || '').slice(0, 500), String(e.detail || '').slice(0, 2000)]));
  return {ok: true, n: Math.min(entries.length, 50)};
}

function serverError_(req, err) {
  const ss = ss_();
  let sh = ss.getSheetByName('APP_ClientLog');
  if (!sh) { sh = ss.insertSheet('APP_ClientLog'); sh.appendRow(['received_at', 'rep_email', 'at', 'level', 'message', 'detail']); }
  sh.appendRow([new Date(), String(req.email || ''), 'server', 'error', String(req.op || ''), String(err && err.stack || err).slice(0, 2000)]);
}

function setTestLogin(login, repEmail, pin) {
  const props = PropertiesService.getScriptProperties();
  const t = JSON.parse(props.getProperty('TEST_LOGINS') || '{}');
  t[String(login).trim().toLowerCase()] = String(repEmail).trim().toLowerCase();
  props.setProperty('TEST_LOGINS', JSON.stringify(t));
  setPin(login, pin);
}

function setPin(email, pin) {
  const props = PropertiesService.getScriptProperties();
  const pins = JSON.parse(props.getProperty('PINS') || '{}');
  pins[String(email).trim().toLowerCase()] = String(pin);
  props.setProperty('PINS', JSON.stringify(pins));
}
