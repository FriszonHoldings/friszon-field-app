const API_VERSION = '1.8.0';
const FIELD_ID = '1pwInjVDR229K2t6yY2uYpXnWzZtDN08zn2yAQAR5J10';
const APP_FOLDER_PATH = ['appsheet', 'data', 'FriszonField-614282017'];
const TZ = 'Asia/Kolkata';
const SLIP_ACTIONS = ['Refilled', 'Monthly confirmation', 'Packs taken back'];

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  if (!p.op) return out_({ok: false, error: 'retry', via: 'get'});
  p.viaGet = true;
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
    const hasPin = req.email && req.pin;
    const hasToken = req.u && req.t;
    if (!hasPin && !hasToken) return out_({ok: false, error: 'retry', via: 'no_credentials'});
    const rep = hasPin ? auth_(req) : authToken_(req.u, req.t);
    mark_('auth');
    if (!rep) return out_({ok: false, error: 'auth'});
    let res;
    if (req.viaGet && ID_COLS_[req.op]) res = bounced_(rep, req.op, req.id);
    else if (req.viaGet && req.op === 'log') res = {ok: true, bounced: true};
    else if (req.op === 'login') res = Object.assign({ok: true, rep: rep}, hasPin ? tokenFor_(String(req.email).trim().toLowerCase(), String(req.pin).trim()) : {});
    else if (req.op === 'bootstrap') res = bootstrap_(rep);
    else if (req.op === 'visit') res = saveVisit_(rep, req.visit);
    else if (req.op === 'pad') res = savePad_(rep, req.pad);
    else if (req.op === 'log') res = saveLog_(rep, req.entries || []);
    else if (req.op === 'dayclose') res = saveDayClose_(rep, req.dayclose);
    else if (req.op === 'deposit') res = saveDeposit_(rep, req.deposit);
    else if (req.op === 'receipt') res = saveReceipt_(rep, req.receipt);
    else if (req.op === 'monthclose') res = saveMonthClose_(rep, req.monthclose);
    else if (req.op === 'prospect') res = saveProspect_(rep, req.prospect);
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

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

function hex_(bytes) {
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function uidOf_(email) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'uid:' + email)).slice(0, 12);
}

function sigOf_(email, pin) {
  return hex_(Utilities.computeHmacSha256Signature(email + '|' + pin, secret_())).slice(0, 40);
}

function tokenFor_(email, pin) {
  return {u: uidOf_(email), t: sigOf_(email, pin)};
}

function authToken_(u, t) {
  const pins = JSON.parse(PropertiesService.getScriptProperties().getProperty('PINS') || '{}');
  const email = Object.keys(pins).find(e => uidOf_(e) === String(u));
  if (!email || sigOf_(email, String(pins[email])) !== String(t)) return null;
  return repFor_(email);
}

const ID_COLS_ = {visit: ['APP_Visits', 'visit_id'], pad: ['APP_SlipPads', 'pad_id'], dayclose: ['APP_DayClose', 'dayclose_id'], deposit: ['APP_Deposits', 'deposit_id'], receipt: ['APP_StockReceived', 'receipt_id'], monthclose: ['APP_MonthClose', 'monthclose_id'], prospect: ['APP_Prospects', 'prospect_id']};
const PROSPECT_STAGE_COL_ = {f1: 'prospect_id', f2: 'q10_footfall', f3: 'q11_terms'};

function bounced_(rep, op, id) {
  if (!id || !ID_COLS_[op]) return {ok: false, error: 'retry', via: 'bounce'};
  if (op === 'prospect') {
    const parts = String(id).split('.');
    const sh = sheet_(ss_(), rep, 'APP_Prospects');
    const row = table_(sh).rows.find(r => String(r.prospect_id) === parts[0]);
    const col = PROSPECT_STAGE_COL_[parts[1] || 'f1'];
    return row && col && String(row[col] === null || row[col] === undefined ? '' : row[col]) !== '' ? {ok: true, duplicate: true, via: 'bounce'} : {ok: false, error: 'retry', via: 'bounce'};
  }
  const ss = ss_();
  const sh = sheet_(ss, rep, ID_COLS_[op][0]);
  const col = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim()).indexOf(ID_COLS_[op][1]) + 1;
  const ids = sh.getLastRow() > 1 && col > 0 ? sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
  return ids.indexOf(String(id)) > -1 ? {ok: true, duplicate: true, via: 'bounce'} : {ok: false, error: 'retry', via: 'bounce'};
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
  return repFor_(email);
}

function repFor_(email) {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
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
  const sizeOf = {};
  const cfgSh = ss.getSheetByName('SHOP_Config');
  if (cfgSh) table_(cfgSh).rows.forEach(c => { sizeOf[String(c.shop_id).trim()] = Number(c.pack_size) || 50; });
  shops.forEach(s => { s.pack_size = sizeOf[s.shop_id] || 50; });
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
  const deposited = {};
  rowsBoth_(ss, rep, 'APP_Deposits').forEach(d => list_(d.collections).forEach(id => { deposited[id] = true; }));
  const shopName = {};
  shops.forEach(s => { shopName[s.shop_id] = s.shop_name; });
  const depositable = visitsT.rows
    .filter(v => String(v.rep_email).trim().toLowerCase() === me && ['Cash', 'Cheque'].indexOf(String(v.pay_mode)) > -1 && String(v.what_happened).indexOf('Payment collected') > -1 && Number(v.amount) > 0 && !String(v.deposit_id || '').trim() && !deposited[String(v.visit_id)])
    .map(v => ({visit_id: String(v.visit_id), shop_id: String(v.shop_id), shop_name: shopName[String(v.shop_id)] || String(v.shop_id), visit_time: iso_(v.visit_time), pay_mode: String(v.pay_mode), amount: Number(v.amount), slip_no: String(v.slip_no || ''), cheque_no: String(v.cheque_no || ''), cheque_date: v.cheque_date instanceof Date ? Utilities.formatDate(v.cheque_date, TZ, 'yyyy-MM-dd') : ''}));
  const dayCloses = rowsBoth_(ss, rep, 'APP_DayClose')
    .filter(d => String(d.rep_email).trim().toLowerCase() === me && d.close_date instanceof Date)
    .map(d => Utilities.formatDate(d.close_date, TZ, 'yyyy-MM-dd'));
  const visitedToday = visitsT.rows
    .filter(v => String(v.rep_email).trim().toLowerCase() === me && v.visit_time instanceof Date && Utilities.formatDate(v.visit_time, TZ, 'yyyy-MM-dd') === todayKey)
    .map(v => ({visit_id: String(v.visit_id), shop_id: String(v.shop_id), visit_time: iso_(v.visit_time), pay_mode: String(v.pay_mode || ''), amount: Number(v.amount) || 0, paid: String(v.what_happened).indexOf('Payment collected') > -1}));
  mark_('core');
  const received = {};
  rowsBoth_(ss, rep, 'APP_StockReceived').forEach(r => { if (String(r.rep_email).trim().toLowerCase() === me) received[String(r.dispatch_id)] = true; });
  const dispBy = {};
  const dSh = ss.getSheetByName('APP_Dispatches');
  if (dSh) table_(dSh).rows.forEach(d => {
    const id = String(d.dispatch_id || '').trim();
    if (!id || received[id] || String(d.rep_email).trim().toLowerCase() !== me || !(Number(d.qty_sent) > 0)) return;
    const x = dispBy[id] = dispBy[id] || {dispatch_id: id, dispatch_date: d.dispatch_date instanceof Date ? Utilities.formatDate(d.dispatch_date, TZ, 'yyyy-MM-dd') : String(d.dispatch_date || ''), lines: []};
    x.lines.push({sku: String(d.sku).trim().toUpperCase(), qty: Number(d.qty_sent)});
  });
  const mc = monthCloseWindow_(rep);
  const mcDone = rowsBoth_(ss, rep, 'APP_MonthClose').some(r => String(r.rep_email).trim().toLowerCase() === me && monthKeyOf_(r.month) === mc.month);
  const pSh = ss.getSheetByName(rep.test ? 'TEST_APP_Prospects' : 'APP_Prospects');
  const prospects = pSh && pSh.getLastRow() > 1 ? table_(pSh).rows.filter(p => String(p.rep_email).trim().toLowerCase() === me && p.prospect_id).map(p => ({
    prospect_id: String(p.prospect_id), shop_name: String(p.shop_name || ''), pincode: String(p.pincode || ''), created_at: iso_(p.created_at),
    q8_community: String(p.q8_community || ''), q9_shop_type: String(p.q9_shop_type || ''),
    has_f2: String(p.q10_footfall === null || p.q10_footfall === undefined ? '' : p.q10_footfall) !== '', has_f3: String(p.q11_terms || '') !== '',
    score: p.score === '' ? '' : Number(p.score), result: String(p.result || ''), score_detail: String(p.score_detail || ''),
    decision: String(p.decision || ''), decision_note: String(p.decision_note || ''), shop_id: String(p.shop_id || ''), stop: f1Stop_(p)
  })) : [];
  return {
    ok: true, version: API_VERSION, now: new Date().toISOString(), rep: rep, test: !!rep.test, shops: shops, today: today,
    products: products, invoices: invoices, last: last, pads: pads, usedSlips: usedSlips, usedRefs: usedRefs, visitedToday: visitedToday, depositable: depositable, dayClosed: dayCloses.indexOf(todayKey) > -1, todayDate: todayKey,
    dispatches: Object.keys(dispBy).map(k => dispBy[k]), monthClose: {month: mc.month, label: mc.label, open: mc.open, done: mcDone, opens: mc.opens}, prospects: prospects
  };
}

function monthKeyOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM');
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : s;
}

function monthCloseWindow_(rep, at) {
  const now = at ? new Date(at) : new Date();
  const y = Number(Utilities.formatDate(now, TZ, 'yyyy')), mo = Number(Utilities.formatDate(now, TZ, 'M')), dom = Number(Utilities.formatDate(now, TZ, 'd'));
  const last = new Date(Date.UTC(y, mo - 2, 15));
  const month = Utilities.formatDate(last, 'UTC', 'yyyy-MM');
  const label = Utilities.formatDate(last, 'UTC', 'MMMM yyyy');
  const next = new Date(Date.UTC(y, mo, 1));
  return {month: month, label: label, open: dom <= 5 || !!(rep && rep.test), opens: Utilities.formatDate(next, 'UTC', '1 MMMM')};
}

function ensureCols_(sh, names) {
  const head = headOf_(sh);
  const missing = names.filter(n => head.indexOf(n) < 0);
  if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  return missing.length ? headOf_(sh) : head;
}

function activeSkus_(ss) {
  return table_(ss.getSheetByName('APP_Products')).rows.filter(p => String(p.active).toUpperCase().indexOf('Y') === 0 || p.active === true).map(p => String(p.sku).trim().toUpperCase());
}

function nonNegInt_(v) {
  return v !== '' && v !== null && v !== undefined && /^\d+$/.test(String(v));
}

function saveReceipt_(rep, r) {
  if (!r || !r.receipt_id || !r.dispatch_id || r.confirm !== true || typeof r.all_ok !== 'boolean') return {ok: false, error: 'bad_receipt', detail: 'missing fields'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_StockReceived');
  if (idsIn_(sh, 'receipt_id').indexOf(String(r.receipt_id)) > -1) { receiptPhotos_(rep, r); return {ok: true, duplicate: true}; }
  const lines = table_(ss.getSheetByName('APP_Dispatches')).rows.filter(d => String(d.dispatch_id).trim() === String(r.dispatch_id) && Number(d.qty_sent) > 0);
  if (!lines.length) return {ok: false, error: 'bad_receipt', detail: 'dispatch ' + r.dispatch_id + ' not found'};
  if (lines.some(d => String(d.rep_email).trim().toLowerCase() !== rep.email)) return {ok: false, error: 'bad_receipt', detail: 'dispatch ' + r.dispatch_id + ' is not yours'};
  if (rowsBoth_(ss, rep, 'APP_StockReceived').some(x => String(x.dispatch_id) === String(r.dispatch_id) && String(x.rep_email).trim().toLowerCase() === rep.email)) return {ok: false, error: 'receipt_exists', detail: 'dispatch ' + r.dispatch_id + ' already received'};
  if (!r.boxes_photo) return {ok: false, error: 'bad_receipt', detail: 'boxes photo missing'};
  const o = {receipt_id: r.receipt_id, dispatch_id: r.dispatch_id, rep_email: rep.email, received_time: new Date(r.saved_at || Date.now()), all_ok: r.all_ok, confirm: true,
    boxes_photo: photoPath_(rep, 'APP_StockReceived_Images', r.receipt_id, 'boxes_photo'), damage_photo: r.damage_photo ? photoPath_(rep, 'APP_StockReceived_Images', r.receipt_id, 'damage_photo') : ''};
  const cols = [];
  for (const d of lines) {
    const s = String(d.sku).trim().toUpperCase();
    cols.push('recv_' + s, 'dmg_' + s);
    if (r.all_ok) { o['recv_' + s] = (o['recv_' + s] || 0) + Number(d.qty_sent); o['dmg_' + s] = 0; continue; }
    const rv = (r.recv || {})[s], dm = (r.dmg || {})[s];
    if (!nonNegInt_(rv) || !nonNegInt_(dm)) return {ok: false, error: 'bad_receipt', detail: 'received and damaged needed for ' + s};
    if (Number(dm) > Number(rv)) return {ok: false, error: 'bad_receipt', detail: 'damaged more than received for ' + s};
    o['recv_' + s] = Number(rv); o['dmg_' + s] = Number(dm);
  }
  if (!r.all_ok && !r.damage_photo) return {ok: false, error: 'bad_receipt', detail: 'photo of the problem missing'};
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (idsIn_(sh, 'receipt_id').indexOf(String(r.receipt_id)) > -1) return {ok: true, duplicate: true};
    const head = ensureCols_(sh, cols);
    sh.appendRow(rowFor_(head, o));
  } finally {
    lock.releaseLock();
  }
  receiptPhotos_(rep, r);
  return {ok: true, receipt_id: r.receipt_id};
}

function receiptPhotos_(rep, r) {
  if (r.boxes_photo) savePhoto_('APP_StockReceived_Images', r.receipt_id, 'boxes_photo', r.boxes_photo, rep);
  if (r.damage_photo) savePhoto_('APP_StockReceived_Images', r.receipt_id, 'damage_photo', r.damage_photo, rep);
}

function saveMonthClose_(rep, m) {
  if (!m || !m.monthclose_id || !m.month || m.confirm !== true) return {ok: false, error: 'bad_monthclose', detail: 'missing fields'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_MonthClose');
  if (idsIn_(sh, 'monthclose_id').indexOf(String(m.monthclose_id)) > -1) return {ok: true, duplicate: true};
  const w = monthCloseWindow_(rep, m.saved_at);
  if (!w.open) return {ok: false, error: 'bad_monthclose', detail: 'Month Close is only open from the 1st to the 5th'};
  if (String(m.month) !== w.month) return {ok: false, error: 'bad_monthclose', detail: 'month must be ' + w.month};
  if (['Agree', 'Disagree'].indexOf(m.verdict) < 0) return {ok: false, error: 'bad_monthclose', detail: 'verdict missing'};
  if (m.verdict === 'Disagree' && String(m.what_is_wrong || '').trim().length < 5) return {ok: false, error: 'bad_monthclose', detail: 'say what is wrong'};
  const skus = activeSkus_(ss);
  const o = {monthclose_id: m.monthclose_id, rep_email: rep.email, month: new Date(w.month + '-01T12:00:00+05:30'), verdict: m.verdict, what_is_wrong: m.verdict === 'Disagree' ? String(m.what_is_wrong).trim() : '', counted_at: new Date(m.saved_at || Date.now())};
  for (const s of skus) {
    const v = (m.stock || {})[s];
    if (!nonNegInt_(v)) return {ok: false, error: 'bad_monthclose', detail: 'count missing for ' + s};
    o['stock_' + s] = Number(v);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (idsIn_(sh, 'monthclose_id').indexOf(String(m.monthclose_id)) > -1) return {ok: true, duplicate: true};
    if (table_(sh).rows.some(r => String(r.rep_email).trim().toLowerCase() === rep.email && monthKeyOf_(r.month) === w.month)) return {ok: false, error: 'monthclose_exists', detail: 'Month Close for ' + w.label + ' already submitted'};
    const head = ensureCols_(sh, skus.map(s => 'stock_' + s));
    sh.appendRow(rowFor_(head, o));
  } finally {
    lock.releaseLock();
  }
  return {ok: true, monthclose_id: m.monthclose_id};
}

const PROSPECT_OPTS_ = {
  q1_premium_section: ['Yes', 'No'],
  q2_premium_products: ['0 or 1', '2', '3 or 4', '5 or more'],
  q3_crowded_shelf: ['Yes', 'No'],
  q4_storage: ['No problem', 'Sunlight heat damp or pests'],
  q5_shopper_match: ['Both', 'South Indian only', 'Gourmet only', 'Neither'],
  q6_fresh_items: ['Yes', 'No'],
  q7_catchment: ['All 3 good signs', 'Families + 1 more good sign', 'Mostly PG or hostels', 'Families, but no other good sign', 'Mostly offices or poor housing'],
  q8_community: ['South Indian', 'Cosmopolitan', 'Mixed', 'PG or hostel belt'],
  q9_shop_type: ['Supermarket', 'Organic or health store', 'Mid-market with premium section', 'Premium kirana', 'Gated-community store'],
  q11_terms: ['Yes', 'No'],
  q12_checks: ['Yes', 'No'],
  q13_shelf: ['Eye or hand level, all facing front', 'Lower shelf, but all visible', 'Bottom shelf only'],
  q14_owner: ['Keen, yes to all 3', 'Keen, but said no to one', 'Not interested'],
  q15_reliability: ['All good', 'Some doubts', 'Red flags'],
  q16_linked_to_rep: ['No', 'Yes'],
  q17_opening_order: ['Standard 20 packs', 'Smaller order requested']
};
const F1_Q_ = ['q1_premium_section', 'q2_premium_products', 'q3_crowded_shelf', 'q4_storage', 'q5_shopper_match', 'q6_fresh_items', 'q7_catchment', 'q8_community', 'q9_shop_type'];
const F3_Q_ = ['q11_terms', 'q12_checks', 'q13_shelf', 'q14_owner', 'q15_reliability', 'q16_linked_to_rep', 'q17_opening_order'];
const PROSPECT_EXTRA_COLS_ = ['q10_start_at', 'q10_end_at', 'q10_start_photo', 'q10_end_photo', 'q12_licence_photo', 'q12_stamp_photo'];

function f1Stop_(a) {
  return a.q1_premium_section === 'No' || a.q2_premium_products === '0 or 1' || a.q4_storage === 'Sunlight heat damp or pests';
}

function f3Stop_(a) {
  return a.q11_terms === 'No' || a.q12_checks === 'No' || a.q13_shelf === 'Bottom shelf only';
}

function checkAnswers_(a, keys, stopFn) {
  for (const k of keys) {
    const v = a[k];
    if (v === undefined || v === '') { if (stopFn(a)) continue; return 'answer ' + k.split('_')[0].toUpperCase(); }
    if (PROSPECT_OPTS_[k].indexOf(v) < 0) return 'bad answer for ' + k;
  }
  return '';
}

function q10WindowOk_(startIso, endIso) {
  const s = new Date(startIso), e = new Date(endIso);
  if (isNaN(s) || isNaN(e)) return 'start and end time missing';
  if (e - s < 15 * 60000 - 5000) return 'count must run for 15 minutes';
  if (e - s > 60 * 60000) return 'count took over an hour - start again';
  const dow = Number(Utilities.formatDate(s, TZ, 'u'));
  const mins = Number(Utilities.formatDate(s, TZ, 'H')) * 60 + Number(Utilities.formatDate(s, TZ, 'm'));
  if (dow === 7) return 'count on a working day (Monday to Saturday)';
  if (mins < 18 * 60 || mins > 19 * 60 + 45) return 'count must start between 6:00 and 7:45 pm';
  return '';
}

function saveProspect_(rep, p) {
  if (!p || !p.prospect_id || ['f1', 'f2', 'f3'].indexOf(p.stage) < 0) return {ok: false, error: 'bad_prospect', detail: 'missing id or stage'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_Prospects');
  const head0 = ensureCols_(sh, PROSPECT_EXTRA_COLS_);
  const a = p.answers || {};
  const photoCol = (col) => photoPath_(rep, 'APP_Prospects_Images', p.prospect_id, col);
  if (p.stage === 'f1') {
    if (idsIn_(sh, 'prospect_id').indexOf(String(p.prospect_id)) > -1) { prospectPhotos_(rep, p); return {ok: true, duplicate: true}; }
    if (String(p.shop_name || '').trim().length < 3) return {ok: false, error: 'bad_prospect', detail: 'shop name'};
    if (String(p.owner_name || '').trim().length < 2) return {ok: false, error: 'bad_prospect', detail: 'owner name'};
    if (!/^[6-9]\d{9}$/.test(String(p.owner_mobile || ''))) return {ok: false, error: 'bad_prospect', detail: 'owner mobile must be 10 digits'};
    if (String(p.address || '').trim().length < 5) return {ok: false, error: 'bad_prospect', detail: 'address'};
    if (!/^\d{6}$/.test(String(p.pincode || ''))) return {ok: false, error: 'bad_prospect', detail: 'pincode must be 6 digits'};
    if (p.gstin && !/^[0-9A-Z]{15}$/.test(String(p.gstin))) return {ok: false, error: 'bad_prospect', detail: 'GST number must be 15 characters'};
    if (!p.gps || /^0\.0+, 0\.0+$/.test(p.gps)) return {ok: false, error: 'bad_prospect', detail: 'location missing'};
    if (!p.front_photo) return {ok: false, error: 'bad_prospect', detail: 'shop front photo missing'};
    const err = checkAnswers_(a, F1_Q_, f1Stop_);
    if (err) return {ok: false, error: 'bad_prospect', detail: err};
    if (!f1Stop_(a) && !p.q2_photo) return {ok: false, error: 'bad_prospect', detail: 'premium products photo missing'};
    const o = {prospect_id: p.prospect_id, rep_email: rep.email, created_at: new Date(p.saved_at || Date.now()), gps: p.gps, shop_name: String(p.shop_name).trim(), owner_name: String(p.owner_name).trim(),
      owner_mobile: String(p.owner_mobile), address: String(p.address).trim(), pincode: String(p.pincode), gstin: String(p.gstin || ''), front_photo: photoCol('front_photo'), q2_photo: p.q2_photo ? photoCol('q2_photo') : ''};
    F1_Q_.forEach(k => { o[k] = a[k] || ''; });
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      if (idsIn_(sh, 'prospect_id').indexOf(String(p.prospect_id)) > -1) return {ok: true, duplicate: true};
      const row = rowFor_(head0, o);
      const pc = head0.indexOf('pincode'), mc = head0.indexOf('owner_mobile');
      sh.appendRow(row);
      const r = sh.getLastRow();
      if (pc > -1) sh.getRange(r, pc + 1).setNumberFormat('@').setValue(String(p.pincode));
      if (mc > -1) sh.getRange(r, mc + 1).setNumberFormat('@').setValue(String(p.owner_mobile));
    } finally {
      lock.releaseLock();
    }
    prospectPhotos_(rep, p);
    return {ok: true, prospect_id: p.prospect_id};
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const v = sh.getDataRange().getValues();
    const head = v[0].map(h => String(h).trim());
    const ci = k => head.indexOf(k);
    const r = v.findIndex((row, k) => k > 0 && String(row[ci('prospect_id')]) === String(p.prospect_id));
    if (r < 1) return {ok: false, error: 'retry', detail: 'prospect ' + p.prospect_id + ' not received yet'};
    const row = v[r];
    const cur = {};
    head.forEach((h, k) => { cur[h] = row[k] instanceof Date ? row[k] : String(row[k] === null || row[k] === undefined ? '' : row[k]); });
    if (String(cur.rep_email).trim().toLowerCase() !== rep.email) return {ok: false, error: 'bad_prospect', detail: 'not your prospect'};
    if (f1Stop_(cur)) return {ok: false, error: 'bad_prospect', detail: 'this shop was rejected in Form 1'};
    const set = {};
    if (p.stage === 'f2') {
      if (cur.q10_footfall !== '') return {ok: true, duplicate: true};
      if (!nonNegInt_(p.q10_footfall) || Number(p.q10_footfall) > 500) return {ok: false, error: 'bad_prospect', detail: 'footfall count'};
      const werr = rep.test ? '' : q10WindowOk_(p.q10_start_at, p.q10_end_at);
      if (werr) return {ok: false, error: 'bad_prospect', detail: werr};
      if (!p.q10_start_photo || !p.q10_end_photo) return {ok: false, error: 'bad_prospect', detail: 'start and end photos'};
      Object.assign(set, {q10_footfall: Number(p.q10_footfall), q10_start_at: new Date(p.q10_start_at), q10_end_at: new Date(p.q10_end_at), q10_start_photo: photoCol('q10_start_photo'), q10_end_photo: photoCol('q10_end_photo')});
    } else {
      if (cur.q11_terms !== '') return {ok: true, duplicate: true};
      if (!rep.test && String(cur.result).indexOf('GO - meet the owner') < 0) return {ok: false, error: 'bad_prospect', detail: 'owner questions open only after GO'};
      const err = checkAnswers_(a, F3_Q_, f3Stop_);
      if (err) return {ok: false, error: 'bad_prospect', detail: err};
      if (a.q12_checks === 'Yes' && (!p.q12_licence_photo || !p.q12_stamp_photo)) return {ok: false, error: 'bad_prospect', detail: 'licence and stamp photos'};
      const skus = activeSkus_(ss);
      const prods = (p.products || []).map(s => String(s).toUpperCase()).filter((s, i, arr) => skus.indexOf(s) > -1 && arr.indexOf(s) === i);
      if (!f3Stop_(a)) {
        if (a.q17_opening_order === 'Standard 20 packs' && prods.length !== 5) return {ok: false, error: 'bad_prospect', detail: 'choose exactly 5 products'};
        if (!prods.length || prods.length > 5) return {ok: false, error: 'bad_prospect', detail: 'choose 1 to 5 products'};
      }
      F3_Q_.forEach(k => { set[k] = a[k] || ''; });
      set.products = prods.join(' , ');
      if (p.q12_licence_photo) set.q12_licence_photo = photoCol('q12_licence_photo');
      if (p.q12_stamp_photo) set.q12_stamp_photo = photoCol('q12_stamp_photo');
    }
    Object.keys(set).forEach(k => { const c = ci(k); if (c > -1) sh.getRange(r + 1, c + 1).setValue(set[k]); });
  } finally {
    lock.releaseLock();
  }
  prospectPhotos_(rep, p);
  return {ok: true, prospect_id: p.prospect_id, stage: p.stage};
}

function prospectPhotos_(rep, p) {
  ['front_photo', 'q2_photo', 'q10_start_photo', 'q10_end_photo', 'q12_licence_photo', 'q12_stamp_photo'].forEach(c => { if (p[c]) savePhoto_('APP_Prospects_Images', p.prospect_id, c, p[c], rep); });
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

function rowFor_(head, o) {
  return head.map(h => Object.prototype.hasOwnProperty.call(o, h) && o[h] !== undefined && o[h] !== null ? o[h] : '');
}

function headOf_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
}

function idsIn_(sh, colName) {
  const head = headOf_(sh);
  const c = head.indexOf(colName) + 1;
  return c > 0 && sh.getLastRow() > 1 ? sh.getRange(2, c, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
}

function saveDayClose_(rep, d) {
  if (!d || !d.dayclose_id || !d.close_date || d.confirm !== true) return {ok: false, error: 'bad_dayclose'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_DayClose');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (idsIn_(sh, 'dayclose_id').indexOf(String(d.dayclose_id)) > -1) return {ok: true, duplicate: true};
    const already = table_(sh).rows.some(r => String(r.rep_email).trim().toLowerCase() === rep.email && r.close_date instanceof Date && Utilities.formatDate(r.close_date, TZ, 'yyyy-MM-dd') === d.close_date);
    if (already) return {ok: false, error: 'dayclose_exists', detail: 'Day Close already submitted for ' + d.close_date};
    const visits = rowsBoth_(ss, rep, 'APP_Visits').filter(v => String(v.rep_email).trim().toLowerCase() === rep.email && v.visit_time instanceof Date && Utilities.formatDate(v.visit_time, TZ, 'yyyy-MM-dd') === d.close_date && String(v.what_happened).indexOf('Payment collected') > -1);
    const cash = visits.filter(v => String(v.pay_mode) === 'Cash').reduce((a, v) => a + (Number(v.amount) || 0), 0);
    const cheques = visits.filter(v => String(v.pay_mode) === 'Cheque').length;
    const o = {dayclose_id: d.dayclose_id, rep_email: rep.email, close_date: new Date(d.close_date + 'T00:00:00+05:30'), cash_collected_calc: Math.round(cash * 100) / 100, cheques_handed: cheques, deposited_all: cash === 0, note: d.note || '', confirm: true, saved_at: d.saved_at ? new Date(d.saved_at) : new Date()};
    sh.appendRow(rowFor_(headOf_(sh), o));
    return {ok: true, cash: o.cash_collected_calc, cheques: cheques};
  } finally {
    lock.releaseLock();
  }
}

function saveDeposit_(rep, d) {
  if (!d || !d.deposit_id || ['Cash', 'Cheque'].indexOf(d.deposit_type) < 0) return {ok: false, error: 'bad_deposit', detail: 'missing id or type'};
  const ss = ss_();
  const depSh = sheet_(ss, rep, 'APP_Deposits');
  if (idsIn_(depSh, 'deposit_id').indexOf(String(d.deposit_id)) > -1) { depositPhoto_(rep, d); return {ok: true, duplicate: true}; }
  const visits = {};
  rowsBoth_(ss, rep, 'APP_Visits').forEach(v => { visits[String(v.visit_id)] = v; });
  const deposited = {};
  table_(depSh).rows.forEach(x => list_(x.collections).forEach(id => { deposited[id] = true; }));
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const cols = (d.collections || []).map(String);
  let total = 0;
  for (const id of cols) {
    const v = visits[id];
    if (!v) return {ok: false, error: 'retry', detail: 'collection ' + id + ' not received yet'};
    if (String(v.rep_email).trim().toLowerCase() !== rep.email) return {ok: false, error: 'bad_deposit', detail: 'collection ' + id + ' is not yours'};
    if (String(v.pay_mode) !== d.deposit_type) return {ok: false, error: 'bad_deposit', detail: 'collection ' + id + ' is ' + v.pay_mode};
    if (deposited[id] || String(v.deposit_id || '').trim()) return {ok: false, error: 'bad_deposit', detail: 'collection ' + id + ' is already in a deposit'};
    if (v.cheque_date instanceof Date && Utilities.formatDate(v.cheque_date, TZ, 'yyyy-MM-dd') > today) return {ok: false, error: 'bad_deposit', detail: 'cheque ' + id + ' is post-dated'};
    total += Number(v.amount) || 0;
  }
  const myShops = {};
  table_(ss.getSheetByName('APP_Shops')).rows.forEach(s => { if (String(s.rep_email).trim().toLowerCase() === rep.email) myShops[String(s.shop_id)] = true; });
  const invs = {};
  table_(ss.getSheetByName('APP_Invoices')).rows.forEach(i => { invs[String(i.invoice_no)] = i; });
  const lines = d.lines || [];
  for (const l of lines) {
    if (!myShops[String(l.shop_id)]) return {ok: false, error: 'bad_deposit', detail: 'shop ' + l.shop_id + ' is not yours'};
    const amt = Number(l.amount) || 0;
    const sp = (l.splits || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
    if (!(amt > 0) || Math.abs(sp - amt) > 0.01) return {ok: false, error: 'bad_deposit', detail: 'older payment for ' + l.shop_id + ' does not match its split'};
    for (const x of l.splits || []) {
      const iv = invs[String(x.invoice_no)];
      if (!iv || String(iv.shop_id) !== String(l.shop_id)) return {ok: false, error: 'bad_deposit', detail: 'invoice ' + x.invoice_no + ' is not for ' + l.shop_id};
    }
    total += amt;
  }
  if (!(Number(d.slip_amount) > 0) || Math.abs(Number(d.slip_amount) - total) > 0.01) return {ok: false, error: 'bad_deposit', detail: 'slip amount ' + d.slip_amount + ' does not equal ' + Math.round(total * 100) / 100};
  if (!String(d.bank_branch || '').trim()) return {ok: false, error: 'bad_deposit', detail: 'bank branch missing'};
  const photoPath = d.slip_photo ? photoPath_(rep, 'APP_Deposits_Images', d.deposit_id, 'slip_photo') : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (idsIn_(depSh, 'deposit_id').indexOf(String(d.deposit_id)) > -1) return {ok: true, duplicate: true};
    const created = d.saved_at ? new Date(d.saved_at) : new Date();
    depSh.appendRow(rowFor_(headOf_(depSh), {deposit_id: d.deposit_id, rep_email: rep.email, created_at: created, deposit_type: d.deposit_type, collections: cols.join(' , '), slip_amount: Number(d.slip_amount), bank_branch: String(d.bank_branch).trim(), deposit_ref: String(d.deposit_ref || '').trim(), slip_photo: photoPath, note: d.note || ''}));
    const lSh = sheet_(ss, rep, 'DEP_Lines'), sSh = sheet_(ss, rep, 'DEP_Splits');
    const lHead = headOf_(lSh), sHead = headOf_(sSh);
    lines.forEach((l, k) => {
      const lineId = d.deposit_id + '-L' + (k + 1);
      lSh.appendRow(rowFor_(lHead, {line_id: lineId, deposit_id: d.deposit_id, shop_id: l.shop_id, amount: Number(l.amount), cheque_no: d.deposit_type === 'Cheque' ? String(l.cheque_no || '') : '', cheque_date: d.deposit_type === 'Cheque' && l.cheque_date ? new Date(l.cheque_date + 'T00:00:00+05:30') : '', rep_email: rep.email, created_at: created}));
      (l.splits || []).forEach((x, j) => sSh.appendRow(rowFor_(sHead, {split_id: lineId + '-S' + (j + 1), line_id: lineId, invoice_no: x.invoice_no, amount: Number(x.amount), balance_reason: x.balance_reason || '', rep_email: rep.email, created_at: created})));
    });
  } finally {
    lock.releaseLock();
  }
  depositPhoto_(rep, d);
  return {ok: true, deposit_id: d.deposit_id};
}

function depositPhoto_(rep, d) {
  if (d.slip_photo) savePhoto_('APP_Deposits_Images', d.deposit_id, 'slip_photo', d.slip_photo, rep);
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
