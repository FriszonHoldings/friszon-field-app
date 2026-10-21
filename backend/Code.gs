const API_VERSION = '1.12.3';
const FIELD_ID = '1pwInjVDR229K2t6yY2uYpXnWzZtDN08zn2yAQAR5J10';
const API_URL_ = 'https://script.google.com/macros/s/AKfycbytE1QRjXO9ZbLY5zU_6-0pNkrYB4fQxiqMdnY6pwcYxYkHZdKdHnt0b9yLDdgEpRh8Jg/exec';
const ADMIN_EMAIL_ = 'bujji.prabhu@gmail.com';
const ATT_HEAD_ = ['att_id', 'rep_email', 'att_date', 'kind', 'event_time', 'phone_time', 'clock_skew_sec', 'received_at', 'gps', 'gps_accuracy', 'selfie', 'rule', 'reason', 'status', 'decided_at', 'decided_by', 'decision_note', 'app_version'];
const ATT_IN_BY_ = 600;
const ATT_OUT_FROM_ = 1080;
const ATT_SKEW_OK_ = 120;
const ATT_WAIVED_ = ['elafisheee24@gmail.com|2026-10-15'];
const APP_FOLDER_PATH = ['appsheet', 'data', 'FriszonField-614282017'];
const TZ = 'Asia/Kolkata';
const SLIP_ACTIONS = ['Refilled', 'Monthly confirmation', 'Packs taken back'];
const VISIT_EXTRA_COLS_ = ['delivery', 'deliver_ref', 'deliver_was', 'deliver_lines', 'deliver_result', 'deliver_reason', 'deliver_pending', 'deliver_invoices', 'invoice_photo', 'place_eye_level', 'place_one_block', 'place_strip', 'place_reason'];
const NO_CARRY_ = ['Shop cancelled the order', 'Shop reduced the order'];
const LEGACY_DELIVERY_DAYS_ = 7;

function parseOrder_(v) {
  const o = {};
  String(v || '').split(',').forEach(part => {
    const m = part.trim().match(/^([A-Z0-9]+)\s*:\s*(\d+)$/i);
    if (m && Number(m[2]) > 0) o[m[1].toUpperCase()] = (o[m[1].toUpperCase()] || 0) + Number(m[2]);
  });
  return o;
}

function orderText_(o) {
  return Object.keys(o || {}).filter(k => Number(o[k]) > 0).map(k => k + ':' + Number(o[k])).join(' , ');
}

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  if (p.op === 'decide') return decidePage_(p);
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
    else if (req.op === 'att') res = saveAtt_(rep, req.att);
    else res = {ok: false, error: 'unknown_op'};
    res.ms = Date.now() - started;
    res.prof = PROF_.join(' ');
    if (res && res.ok === false && req.op !== 'bootstrap') { try { refusal_(rep, req, res); } catch (e3) {} }
    return out_(res);
  } catch (err) {
    try { serverError_(req, err); } catch (e2) {}
    return out_({ok: false, error: 'server', detail: String(err && err.message || err)});
  }
}

function refusal_(rep, req, res) {
  const sh = ss_().getSheetByName('APP_ClientLog');
  if (!sh) return;
  const body = req[req.op] || {};
  sh.appendRow([new Date(), rep.email, 'server', 'refused', String(req.op) + (req.viaGet ? ' (bounced GET)' : ''), JSON.stringify({error: res.error, detail: res.detail || '', id: req.id || body.att_id || body.visit_id || '', kind: body.kind || '', event_time: body.event_time || '', attempts: body.attempts || ''}).slice(0, 1500)]);
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

const ID_COLS_ = {visit: ['APP_Visits', 'visit_id'], pad: ['APP_SlipPads', 'pad_id'], dayclose: ['APP_DayClose', 'dayclose_id'], deposit: ['APP_Deposits', 'deposit_id'], receipt: ['APP_StockReceived', 'receipt_id'], monthclose: ['APP_MonthClose', 'monthclose_id'], prospect: ['APP_Prospects', 'prospect_id'], att: ['APP_Attendance', 'att_id']};
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
    CacheService.getScriptCache().remove('sheet_meta');
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

const BOOT_SHEETS_ = ['APP_Shops', 'SHOP_Config', 'APP_Today', 'APP_Products', 'APP_Invoices', 'APP_Visits', 'APP_SlipPads', 'APP_Deposits', 'APP_DayClose', 'APP_StockReceived', 'APP_Dispatches', 'APP_MonthClose', 'APP_Prospects', 'INV_Log', 'APP_Attendance'];
const BOOT_TEST_ = ['APP_Visits', 'APP_SlipPads', 'APP_Deposits', 'APP_DayClose', 'APP_StockReceived', 'APP_MonthClose', 'APP_Prospects', 'APP_Attendance'];
const DATE_COLS_ = {visit_time: 1, cheque_date: 1, close_date: 1, dispatch_date: 1, month: 1, counted_at: 1, received_time: 1, created_at: 1, last_visit: 1, inv_date: 1, saved_at: 1, onboarded_on: 1, att_date: 1, event_time: 1, phone_time: 1, received_at: 1, decided_at: 1};

function sheetMeta_(fresh) {
  const cache = CacheService.getScriptCache();
  const hit = fresh ? null : cache.get('sheet_meta');
  if (hit) return JSON.parse(hit);
  const r = Sheets.Spreadsheets.get(FIELD_ID, {fields: 'properties.timeZone,sheets.properties.title'});
  const meta = {tz: r.properties.timeZone || TZ, names: (r.sheets || []).map(x => x.properties.title)};
  cache.put('sheet_meta', JSON.stringify(meta), 3600);
  return meta;
}

function serialDate_(n, offMs) {
  return new Date(Math.round((n - 25569) * 86400000) - offMs);
}

function tableFrom_(values, offMs) {
  const head = (values[0] || []).map(h => String(h).trim());
  const rows = values.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined)).map(r => {
    const o = {};
    head.forEach((h, i) => {
      if (!h) return;
      let v = r[i] === undefined || r[i] === null ? '' : r[i];
      if (DATE_COLS_[h] && typeof v === 'number') v = serialDate_(v, offMs);
      o[h] = v;
    });
    return o;
  });
  return {head: head, rows: rows};
}

function bulk_(names) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const meta = sheetMeta_(attempt > 0);
      const want = names.filter(n => meta.names.indexOf(n) > -1);
      const z = Utilities.formatDate(new Date(), meta.tz, 'Z');
      const offMs = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))) * 60000;
      const res = Sheets.Spreadsheets.Values.batchGet(FIELD_ID, {ranges: want.map(n => "'" + n.replace(/'/g, "''") + "'"), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER'});
      const out = {};
      (res.valueRanges || []).forEach((vr, k) => { out[want[k]] = tableFrom_(vr.values || [], offMs); });
      mark_('bulk' + attempt);
      return out;
    } catch (err) {
      if (attempt > 0) {
        try { serverError_({op: 'bulk'}, err); } catch (e2) {}
        const ss = ss_();
        const out = {};
        names.forEach(n => { const sh = ss.getSheetByName(n); if (sh) out[n] = table_(sh); });
        mark_('bulkfallback');
        return out;
      }
    }
  }
}

function bootstrap_(rep) {
  const B = bulk_(rep.test ? BOOT_SHEETS_.concat(BOOT_TEST_.map(n => 'TEST_' + n)) : BOOT_SHEETS_);
  const rowsOf = n => (B[n] || {rows: []}).rows;
  const both = n => rep.test ? rowsOf(n).concat(rowsOf('TEST_' + n)) : rowsOf(n);
  const me = rep.email;
  const shops = rowsOf('APP_Shops')
    .filter(s => String(s.rep_email).trim().toLowerCase() === me)
    .map(s => ({
      shop_id: String(s.shop_id), shop_name: String(s.shop_name), status: String(s.status),
      products: list_(s.products_stocked), owner_name: String(s.owner_name || ''),
      owner_mobile: String(s.owner_mobile || ''), pincode: String(s.pincode || '')
    }));
  const sizeOf = {};
  rowsOf('SHOP_Config').forEach(c => { sizeOf[String(c.shop_id).trim()] = Number(c.pack_size) || 50; });
  shops.forEach(s => { s.pack_size = sizeOf[s.shop_id] || 50; });
  const myShopIds = {};
  shops.forEach(s => { myShopIds[s.shop_id] = true; });
  const today = rowsOf('APP_Today')
    .filter(t => myShopIds[String(t.shop_id)])
    .map(t => ({
      shop_id: String(t.shop_id), amount_due: Number(t.amount_due) || 0, refill_plan: String(t.refill_plan || ''),
      monthly_confirmation_due: t.monthly_confirmation_due === true || String(t.monthly_confirmation_due).toUpperCase() === 'TRUE',
      payment_overdue: t.payment_overdue === true || String(t.payment_overdue).toUpperCase() === 'TRUE',
      last_visit: iso_(t.last_visit), flag: String(t.flag || '')
    }));
  const products = rowsOf('APP_Products')
    .filter(p => String(p.active).toUpperCase().indexOf('Y') === 0 || p.active === true)
    .map(p => ({sku: String(p.sku), name: String(p.name), pack: String(p.pack || '')}));
  const invoices = rowsOf('APP_Invoices')
    .filter(i => myShopIds[String(i.shop_id)] && ['Open', 'Awaiting approval'].indexOf(String(i.status)) > -1)
    .map(i => ({invoice_no: String(i.invoice_no), shop_id: String(i.shop_id), inv_date: iso_(i.inv_date), balance: Number(i.balance) || 0, label: String(i.label || i.invoice_no)}));
  const visitsT = {rows: both('APP_Visits')};
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
  const invByVisit = {};
  rowsOf('INV_Log').forEach(l => { if (String(l.doc_type) === 'INV' && String(l.status) === 'OK' && l.visit_id) (invByVisit[String(l.visit_id)] = invByVisit[String(l.visit_id)] || []).push(String(l.doc_no)); });
  const visById = {};
  visitsT.rows.forEach(v => { if (v.visit_id) visById[String(v.visit_id)] = v; });
  const owedInvoices = v0 => {
    const out = [];
    let v = v0;
    for (let k = 0; v && k < 12; k++) {
      if (String(v.delivery || '') === 'Next visit' || (k === 0 && String(v.delivery || '') === '')) (invByVisit[String(v.visit_id)] || []).forEach(n => { if (out.indexOf(n) < 0) out.push(n); });
      const res = String(v.deliver_result || '');
      if (!((res === 'Part delivered' || res === 'Not delivered') && NO_CARRY_.indexOf(String(v.deliver_reason || '')) < 0)) break;
      v = visById[String(v.deliver_ref || '')];
    }
    return out;
  };
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
    const refill = {};
    Object.keys(v).forEach(k => { const m = k.match(/^refill_(.+)$/); if (m && m[1] !== 'override' && Number(v[k]) > 0) refill[m[1]] = Number(v[k]); });
    const newStyle = String(v.delivery || '') !== '' || String(v.deliver_result || '') !== '';
    const age = v.visit_time instanceof Date ? (Date.now() - v.visit_time.getTime()) / 86400000 : 999;
    last[sid] = {visit_time: iso_(v.visit_time), after: after, visit_id: String(v.visit_id || ''), pending: parseOrder_(v.deliver_pending), legacy: !newStyle && Object.keys(refill).length > 0 && age <= LEGACY_DELIVERY_DAYS_ ? refill : null};
    last[sid].invoices = (Object.keys(last[sid].pending).length || last[sid].legacy) ? owedInvoices(v) : [];
  });
  const pads = both('APP_SlipPads')
    .filter(p => String(p.rep_email).trim().toLowerCase() === me)
    .map(p => ({pad_id: String(p.pad_id), first_no: Number(p.first_no), last_no: Number(p.last_no)}));
  const todayKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const deposited = {};
  both('APP_Deposits').forEach(d => list_(d.collections).forEach(id => { deposited[id] = true; }));
  const shopName = {};
  shops.forEach(s => { shopName[s.shop_id] = s.shop_name; });
  const depositable = visitsT.rows
    .filter(v => String(v.rep_email).trim().toLowerCase() === me && ['Cash', 'Cheque'].indexOf(String(v.pay_mode)) > -1 && String(v.what_happened).indexOf('Payment collected') > -1 && Number(v.amount) > 0 && !String(v.deposit_id || '').trim() && !deposited[String(v.visit_id)])
    .map(v => ({visit_id: String(v.visit_id), shop_id: String(v.shop_id), shop_name: shopName[String(v.shop_id)] || String(v.shop_id), visit_time: iso_(v.visit_time), pay_mode: String(v.pay_mode), amount: Number(v.amount), slip_no: String(v.slip_no || ''), cheque_no: String(v.cheque_no || ''), cheque_date: v.cheque_date instanceof Date ? Utilities.formatDate(v.cheque_date, TZ, 'yyyy-MM-dd') : ''}));
  const dayCloses = both('APP_DayClose')
    .filter(d => String(d.rep_email).trim().toLowerCase() === me && d.close_date instanceof Date)
    .map(d => Utilities.formatDate(d.close_date, TZ, 'yyyy-MM-dd'));
  const visitedToday = visitsT.rows
    .filter(v => String(v.rep_email).trim().toLowerCase() === me && v.visit_time instanceof Date && Utilities.formatDate(v.visit_time, TZ, 'yyyy-MM-dd') === todayKey)
    .map(v => ({visit_id: String(v.visit_id), shop_id: String(v.shop_id), visit_time: iso_(v.visit_time), pay_mode: String(v.pay_mode || ''), amount: Number(v.amount) || 0, paid: String(v.what_happened).indexOf('Payment collected') > -1}));
  mark_('core');
  const received = {};
  both('APP_StockReceived').forEach(r => { if (String(r.rep_email).trim().toLowerCase() === me) received[String(r.dispatch_id)] = true; });
  const dispBy = {};
  rowsOf('APP_Dispatches').forEach(d => {
    const id = String(d.dispatch_id || '').trim();
    if (!id || received[id] || String(d.rep_email).trim().toLowerCase() !== me || !(Number(d.qty_sent) > 0)) return;
    const x = dispBy[id] = dispBy[id] || {dispatch_id: id, dispatch_date: d.dispatch_date instanceof Date ? Utilities.formatDate(d.dispatch_date, TZ, 'yyyy-MM-dd') : String(d.dispatch_date || ''), lines: []};
    x.lines.push({sku: String(d.sku).trim().toUpperCase(), qty: Number(d.qty_sent)});
  });
  const mc = monthCloseWindow_(rep);
  const mcDone = both('APP_MonthClose').some(r => String(r.rep_email).trim().toLowerCase() === me && monthKeyOf_(r.month) === mc.month);
  const prospects = rowsOf(rep.test ? 'TEST_APP_Prospects' : 'APP_Prospects').filter(p => String(p.rep_email).trim().toLowerCase() === me && p.prospect_id).map(p => ({
    prospect_id: String(p.prospect_id), shop_name: String(p.shop_name || ''), pincode: String(p.pincode || ''), created_at: iso_(p.created_at),
    q8_community: String(p.q8_community || ''), q9_shop_type: String(p.q9_shop_type || ''),
    has_f2: String(p.q10_footfall === null || p.q10_footfall === undefined ? '' : p.q10_footfall) !== '', has_f3: String(p.q11_terms || '') !== '',
    score: p.score === '' ? '' : Number(p.score), result: String(p.result || ''), score_detail: String(p.score_detail || ''),
    decision: String(p.decision || ''), decision_note: String(p.decision_note || ''), shop_id: String(p.shop_id || ''), stop: f1Stop_(p)
  }));
  const attendance = rowsOf(rep.test ? 'TEST_APP_Attendance' : 'APP_Attendance')
    .filter(r => String(r.rep_email).trim().toLowerCase() === me && r.att_date instanceof Date && Utilities.formatDate(r.att_date, TZ, 'yyyy-MM-dd') === todayKey)
    .map(r => ({att_id: String(r.att_id), kind: String(r.kind), event_time: iso_(r.event_time), rule: String(r.rule || ''), reason: String(r.reason || ''), status: String(r.status || ''), decision_note: String(r.decision_note || '')}));
  const attPrev = attMissed_(rowsOf(rep.test ? 'TEST_APP_Attendance' : 'APP_Attendance'), me, todayKey);
  return {
    ok: true, version: API_VERSION, now: new Date().toISOString(), rep: rep, test: !!rep.test, shops: shops, today: today,
    products: products, invoices: invoices, last: last, pads: pads, usedSlips: usedSlips, usedRefs: usedRefs, visitedToday: visitedToday, depositable: depositable, dayClosed: dayCloses.indexOf(todayKey) > -1, todayDate: todayKey,
    dispatches: Object.keys(dispBy).map(k => dispBy[k]), monthClose: {month: mc.month, label: mc.label, open: mc.open, done: mcDone, opens: mc.opens}, prospects: prospects,
    attendance: attendance, attPrev: attPrev, workday: Number(Utilities.formatDate(new Date(), TZ, 'u')) <= 6
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
    SpreadsheetApp.flush(); lock.releaseLock();
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
    SpreadsheetApp.flush(); lock.releaseLock();
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

function saveProspect_(rep, p) {
  if (!p || !p.prospect_id || ['f1', 'f2', 'f3'].indexOf(p.stage) < 0) return {ok: false, error: 'bad_prospect', detail: 'missing id or stage'};
  const ss = ss_();
  const sh = sheet_(ss, rep, 'APP_Prospects');
  const head0 = headOf_(sh);
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
      SpreadsheetApp.flush(); lock.releaseLock();
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
      set.q10_footfall = Number(p.q10_footfall);
    } else {
      if (cur.q11_terms !== '') return {ok: true, duplicate: true};
      if (!rep.test && String(cur.result).indexOf('GO - meet the owner') < 0) return {ok: false, error: 'bad_prospect', detail: 'owner questions open only after GO'};
      const err = checkAnswers_(a, F3_Q_, f3Stop_);
      if (err) return {ok: false, error: 'bad_prospect', detail: err};
      const skus = activeSkus_(ss);
      const prods = (p.products || []).map(s => String(s).toUpperCase()).filter((s, i, arr) => skus.indexOf(s) > -1 && arr.indexOf(s) === i);
      if (!f3Stop_(a)) {
        if (a.q17_opening_order === 'Standard 20 packs' && prods.length !== 5) return {ok: false, error: 'bad_prospect', detail: 'choose exactly 5 products'};
        if (!prods.length || prods.length > 5) return {ok: false, error: 'bad_prospect', detail: 'choose 1 to 5 products'};
      }
      F3_Q_.forEach(k => { set[k] = a[k] || ''; });
      set.products = prods.join(' , ');
    }
    Object.keys(set).forEach(k => { const c = ci(k); if (c > -1) sh.getRange(r + 1, c + 1).setValue(set[k]); });
  } finally {
    SpreadsheetApp.flush(); lock.releaseLock();
  }
  prospectPhotos_(rep, p);
  return {ok: true, prospect_id: p.prospect_id, stage: p.stage};
}

function prospectPhotos_(rep, p) {
  ['front_photo', 'q2_photo'].forEach(c => { if (p[c]) savePhoto_('APP_Prospects_Images', p.prospect_id, c, p[c], rep); });
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
  if (v.invoice_photo) savePhoto_('APP_Visits_Images', v.visit_id, 'invoice_photo', v.invoice_photo, rep);
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
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
  mark_('ids');
  const fx = v.fields || {};
  ['deliver_was', 'deliver_lines', 'deliver_pending'].forEach(k => { if (Object.prototype.hasOwnProperty.call(fx, k)) fx[k] = orderText_(parseOrder_(fx[k])); });
  if (VISIT_EXTRA_COLS_.some(k => fx[k] !== undefined && fx[k] !== null && String(fx[k]) !== '') && VISIT_EXTRA_COLS_.some(k => head.indexOf(k) < 0)) head = ensureCols_(sh, VISIT_EXTRA_COLS_);
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
  const invPhoto = v.invoice_photo ? photoPath_(rep, 'APP_Visits_Images', v.visit_id, 'invoice_photo') : '';
  if (invPhoto) fx.invoice_photo = invPhoto;
  const f = v.fields || {};
  const row = head.map(h => {
    if (h === 'visit_id') return v.visit_id;
    if (h === 'shop_id') return v.shop_id;
    if (h === 'rep_email') return rep.email;
    if (h === 'visit_time') return new Date(v.visit_time);
    if (h === 'gps') return v.gps || '0.000000, 0.000000';
    if (h === 'shelf_photo') return shelf;
    if (h === 'slip_photo') return slip;
    if (h === 'invoice_photo') return invPhoto;
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
    SpreadsheetApp.flush(); lock.releaseLock();
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
    SpreadsheetApp.flush(); lock.releaseLock();
  }
}

function istParts_(d) {
  return {date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), min: Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')), dow: Number(Utilities.formatDate(d, TZ, 'u'))};
}

function attSheet_(ss, rep) {
  let base = ss.getSheetByName('APP_Attendance');
  if (!base) {
    base = ss.insertSheet('APP_Attendance');
    base.getRange(1, 1, 1, ATT_HEAD_.length).setValues([ATT_HEAD_]);
    base.setFrozenRows(1);
    CacheService.getScriptCache().remove('sheet_meta');
  }
  const sh = sheet_(ss, rep, 'APP_Attendance');
  if (sh.getLastColumn() === 0) sh.getRange(1, 1, 1, ATT_HEAD_.length).setValues([ATT_HEAD_]);
  return sh;
}

function attSig_(id, test) {
  return hex_(Utilities.computeHmacSha256Signature('att|' + id + '|' + (test ? 1 : 0), secret_())).slice(0, 32);
}

function attStatusOf_(sh, id) {
  const r = table_(sh).rows.find(x => String(x.att_id) === String(id));
  return r ? {status: String(r.status), rule: String(r.rule)} : {};
}

function attPrevDay_(key) {
  for (let k = 1; k < 8; k++) {
    const d = new Date(new Date(key + 'T12:00:00+05:30').getTime() - k * 86400000);
    if (Number(Utilities.formatDate(d, TZ, 'u')) <= 6) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  }
  return '';
}

function attMissed_(rows, email, key) {
  const prev = attPrevDay_(key);
  const day = rows.filter(r => String(r.rep_email).trim().toLowerCase() === email && r.att_date instanceof Date && Utilities.formatDate(r.att_date, TZ, 'yyyy-MM-dd') === prev);
  const inOk = day.some(r => String(r.kind) === 'IN' && ['OK', 'Approved'].indexOf(String(r.status)) > -1);
  const outDone = day.some(r => String(r.kind) === 'OUT' && ['OK', 'Approved', 'Pending'].indexOf(String(r.status)) > -1);
  return {date: prev, label: prev ? Utilities.formatDate(new Date(prev + 'T12:00:00+05:30'), TZ, 'EEE d MMM') : '', missed: !!prev && inOk && !outDone && ATT_WAIVED_.indexOf(email + '|' + prev) < 0};
}

function attWhat_(o) {
  const rule = String(o.rule || '');
  if (String(o.kind) !== 'IN') return 'early mark-out';
  if (rule === 'Missed mark-out') return 'mark-in after a missed mark-out';
  if (rule === 'Late, missed mark-out') return 'late mark-in after a missed mark-out';
  return 'late mark-in';
}

function saveAtt_(rep, a) {
  if (!a || !a.att_id || ['IN', 'OUT'].indexOf(a.kind) < 0) return {ok: false, error: 'bad_att', detail: 'missing id or kind'};
  const phoneTime = new Date(a.event_time);
  if (isNaN(phoneTime.getTime())) return {ok: false, error: 'bad_att', detail: 'time missing'};
  if (!a.selfie) return {ok: false, error: 'bad_att', detail: 'selfie missing'};
  const ss = ss_();
  const sh = attSheet_(ss, rep);
  if (idsIn_(sh, 'att_id').indexOf(String(a.att_id)) > -1) { attPhoto_(rep, a); return Object.assign({ok: true, duplicate: true}, attStatusOf_(sh, a.att_id)); }
  const now = new Date();
  const sentAt = a.sent_at ? new Date(a.sent_at) : null;
  const skew = sentAt && !isNaN(sentAt.getTime()) ? Math.round((now.getTime() - sentAt.getTime()) / 1000) : 0;
  const used = Math.abs(skew) > ATT_SKEW_OK_ ? new Date(phoneTime.getTime() + skew * 1000) : phoneTime;
  const p = istParts_(used);
  const workday = p.dow <= 6;
  const base = a.kind === 'IN' ? (!workday ? 'Sunday' : p.min < ATT_IN_BY_ ? 'On time' : 'Late') : (!workday ? 'Sunday' : p.min >= ATT_OUT_FROM_ ? 'After 6 pm' : 'Early');
  const late = base === 'Late' || base === 'Early';
  let reason = String(a.reason || '').trim();
  if (late && reason.length < 5 && used !== phoneTime) reason = 'No reason given – his phone clock was ' + Math.round(Math.abs(skew) / 60) + ' min ' + (skew > 0 ? 'slow' : 'fast') + ', so the app treated this as within time';
  if (late && reason.length < 5) return {ok: false, error: 'bad_att', detail: 'reason needed for ' + (a.kind === 'IN' ? 'a late mark-in' : 'an early mark-out')};
  const miss = a.kind === 'IN' && workday ? attMissed_(table_(sh).rows, rep.email, p.date) : {missed: false};
  const missReason = String(a.missed_reason || '').trim();
  if (miss.missed && missReason.length < 5) return {ok: false, error: 'bad_att', detail: 'reason needed for the missed mark-out on ' + miss.label};
  if (miss.missed) reason = 'No mark-out on ' + miss.label + ': ' + missReason + (late ? ' | Late: ' + reason : '');
  const rule = miss.missed ? (late ? 'Late, missed mark-out' : 'Missed mark-out') : base;
  const pending = late || miss.missed;
  const o = {att_id: a.att_id, rep_email: rep.email, att_date: new Date(p.date + 'T00:00:00+05:30'), kind: a.kind, event_time: used, phone_time: phoneTime, clock_skew_sec: skew, received_at: now,
    gps: a.gps || '', gps_accuracy: a.gps_accuracy || '', selfie: photoPath_(rep, 'APP_Attendance_Images', a.att_id, 'selfie'), rule: rule, reason: reason, status: pending ? 'Pending' : 'OK', app_version: a.app_version || ''};
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (idsIn_(sh, 'att_id').indexOf(String(a.att_id)) > -1) return Object.assign({ok: true, duplicate: true}, attStatusOf_(sh, a.att_id));
    const day = table_(sh).rows.filter(r => String(r.rep_email).trim().toLowerCase() === rep.email && r.att_date instanceof Date && Utilities.formatDate(r.att_date, TZ, 'yyyy-MM-dd') === p.date);
    if (a.kind === 'IN') {
      if (day.some(r => String(r.kind) === 'IN')) return {ok: false, error: 'att_exists', detail: 'already marked in on ' + p.date};
    } else {
      const ins = day.filter(r => String(r.kind) === 'IN');
      if (!ins.length) return {ok: false, error: 'bad_att', detail: 'no mark-in on ' + p.date};
      if (!ins.some(r => ['OK', 'Approved'].indexOf(String(r.status)) > -1)) return {ok: false, error: 'bad_att', detail: ins.some(r => String(r.status) === 'Pending') ? 'mark-in not approved yet' : 'mark-in was rejected'};
      if (day.some(r => String(r.kind) === 'OUT' && String(r.status) !== 'Rejected')) return {ok: false, error: 'att_exists', detail: 'already marked out on ' + p.date};
    }
    sh.appendRow(rowFor_(ensureCols_(sh, ATT_HEAD_), o));
  } finally {
    SpreadsheetApp.flush(); lock.releaseLock();
  }
  attPhoto_(rep, a);
  if (pending) attNotify_(rep, o, a.selfie);
  return {ok: true, att_id: a.att_id, status: o.status, rule: rule};
}

function attPhoto_(rep, a) {
  if (a.selfie) savePhoto_('APP_Attendance_Images', a.att_id, 'selfie', a.selfie, rep);
}

function htmlEsc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function attNotify_(rep, o, selfie) {
  try {
    const what = attWhat_(o);
    const when = Utilities.formatDate(o.event_time, TZ, 'h:mm a, EEE d MMM');
    const link = API_URL_ + '?op=decide&id=' + encodeURIComponent(o.att_id) + (rep.test ? '&x=1' : '') + '&s=' + attSig_(o.att_id, rep.test);
    const map = o.gps ? 'https://maps.google.com/?q=' + encodeURIComponent(o.gps) : '';
    const m = String(selfie || '').match(/^data:(image\/[a-z]+);base64,(.+)$/);
    const inline = m ? {selfie: Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'selfie.jpg')} : {};
    const skew = Math.abs(o.clock_skew_sec) > ATT_SKEW_OK_ ? '<p style="color:#b00020">His phone clock was ' + Math.round(Math.abs(o.clock_skew_sec) / 60) + ' minutes ' + (o.clock_skew_sec > 0 ? 'behind' : 'ahead') + '. The time above is corrected.</p>' : '';
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;max-width:520px">' +
      '<h2 style="margin:0 0 8px">' + htmlEsc_(rep.name) + ' asks for a ' + what + '</h2>' +
      '<p><b>Time:</b> ' + htmlEsc_(when) + '<br><b>Reason:</b> ' + htmlEsc_(o.reason) + '<br><b>Location:</b> ' + (map ? '<a href="' + map + '">open map</a>' + (o.gps_accuracy ? ' (±' + htmlEsc_(o.gps_accuracy) + ' m)' : '') : 'not available') + '</p>' + skew +
      (m ? '<p><img src="cid:selfie" style="max-width:260px;border-radius:8px"></p>' : '') +
      '<p><a href="' + link + '" style="display:inline-block;background:#1b5e20;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Approve or reject</a></p>' +
      '<p style="color:#666;font-size:13px">' + (o.kind === 'IN' ? 'His shop visits stay locked until you approve.' : 'His shop visits are locked while this waits. If you reject, he carries on until 6 pm.') + '</p></div>';
    MailApp.sendEmail({to: ADMIN_EMAIL_, subject: (rep.test ? '[TEST] ' : '') + rep.name + ' – ' + what + ' request, ' + when, htmlBody: html, inlineImages: inline, name: 'Friszon Field'});
  } catch (err) {
    try { serverError_({op: 'att_mail', email: rep.email}, err); } catch (e2) {}
  }
}

function attFind_(test, id) {
  const sh = ss_().getSheetByName((test ? 'TEST_' : '') + 'APP_Attendance');
  if (!sh) return null;
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const ic = head.indexOf('att_id');
  const r = v.findIndex((row, k) => k > 0 && String(row[ic]) === String(id));
  if (r < 1) return null;
  const o = {};
  head.forEach((h, k) => { o[h] = v[r][k]; });
  return {sh: sh, head: head, row: r + 1, o: o};
}

function attSelfie_(test, id) {
  try {
    const it = folder_((test ? 'TEST_' : '') + 'APP_Attendance_Images').getFilesByName(id + '.selfie.jpg');
    if (!it.hasNext()) return '';
    const b = it.next().getBlob();
    return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
  } catch (e) {
    return '';
  }
}

function repName_(email) {
  const r = table_(ss_().getSheetByName('APP_Reps')).rows.find(x => String(x.rep_email).trim().toLowerCase() === String(email).trim().toLowerCase());
  return r ? String(r.name || email) : String(email);
}

function decidePage_(p) {
  const test = String(p.x || '') === '1';
  const id = String(p.id || '');
  const sig = String(p.s || '');
  let body = '';
  if (!id || sig !== attSig_(id, test)) body = '<h2>This link is not valid.</h2>';
  else {
    const f = attFind_(test, id);
    if (!f) body = '<h2>Request not found.</h2>';
    else {
      const o = f.o;
      const what = attWhat_(o).replace(/^./, c => c.toUpperCase());
      const when = o.event_time instanceof Date ? Utilities.formatDate(o.event_time, TZ, 'h:mm a, EEE d MMM yyyy') : String(o.event_time);
      const map = o.gps ? 'https://maps.google.com/?q=' + encodeURIComponent(String(o.gps)) : '';
      const pic = attSelfie_(test, id);
      const st = String(o.status) + (o.decided_at instanceof Date ? ' · ' + Utilities.formatDate(o.decided_at, TZ, 'h:mm a, d MMM') : '');
      body = '<h2>' + (test ? '[TEST] ' : '') + htmlEsc_(repName_(o.rep_email)) + ' – ' + what + '</h2>' +
        '<p><b>Time:</b> ' + htmlEsc_(when) + '<br><b>Reason:</b> ' + htmlEsc_(o.reason) + '<br><b>Location:</b> ' + (map ? '<a href="' + map + '" target="_blank">open map</a>' : 'not available') + '</p>' +
        (pic ? '<img src="' + pic + '" style="max-width:100%;width:280px;border-radius:10px">' : '<p>Selfie not available yet.</p>') +
        '<p><b>Status:</b> <span id="st">' + htmlEsc_(st) + '</span></p>';
      if (['Pending', 'Approved', 'Rejected'].indexOf(String(o.status)) < 0) body += '<p>This entry was within the rules. Nothing to approve.</p>';
      else body += '<textarea id="n" rows="2" placeholder="Note for him (optional)">' + htmlEsc_(o.decision_note) + '</textarea>' +
        '<div class="b"><button class="ok" onclick="go(\'Approved\')">Approve</button><button class="no" onclick="go(\'Rejected\')">Reject</button></div><p id="r"></p>' +
        '<script>function go(d){var b=document.querySelectorAll("button"),i;for(i=0;i<b.length;i++)b[i].disabled=true;document.getElementById("r").textContent="Saving…";' +
        'google.script.run.withSuccessHandler(function(res){document.getElementById("st").textContent=res.status+" · "+res.when;document.getElementById("r").textContent=res.status==="Approved"?"Approved. His app updates within a minute.":"Rejected. His app shows this within a minute.";for(i=0;i<b.length;i++)b[i].disabled=false;})' +
        '.withFailureHandler(function(e){document.getElementById("r").textContent="Could not save: "+(e&&e.message||e);for(i=0;i<b.length;i++)b[i].disabled=false;})' +
        '.decideAtt(' + JSON.stringify(id) + ',' + JSON.stringify(test ? '1' : '') + ',' + JSON.stringify(sig) + ',d,document.getElementById("n").value);}</script>';
    }
  }
  const css = '<style>body{font-family:Arial,sans-serif;font-size:16px;line-height:1.5;margin:16px;color:#111}h2{font-size:20px}textarea{width:100%;box-sizing:border-box;font-size:16px;padding:8px}.b{display:flex;gap:12px;margin-top:12px}.b button{flex:1;padding:14px;font-size:17px;font-weight:bold;border:0;border-radius:8px;color:#fff}.ok{background:#1b5e20}.no{background:#b00020}button:disabled{opacity:.5}</style>';
  return HtmlService.createHtmlOutput('<base target="_top">' + css + body).setTitle('Friszon attendance').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function decideAtt(id, x, s, decision, note) {
  const test = String(x) === '1';
  if (String(s) !== attSig_(String(id), test)) throw new Error('link not valid');
  if (['Approved', 'Rejected'].indexOf(decision) < 0) throw new Error('bad decision');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const f = attFind_(test, id);
    if (!f) throw new Error('request not found');
    if (['Pending', 'Approved', 'Rejected'].indexOf(String(f.o.status)) < 0) throw new Error('this entry needs no approval');
    const now = new Date();
    const set = {status: decision, decided_at: now, decided_by: 'Ashwin', decision_note: String(note || '').trim().slice(0, 300)};
    const idc = f.head.indexOf('att_id');
    f.sh.getDataRange().getValues().forEach((row, k) => { if (k > 0 && String(row[idc]) === String(id)) Object.keys(set).forEach(key => { const c = f.head.indexOf(key); if (c > -1) f.sh.getRange(k + 1, c + 1).setValue(set[key]); }); });
    return {status: decision, when: Utilities.formatDate(now, TZ, 'h:mm a, d MMM')};
  } finally {
    SpreadsheetApp.flush(); lock.releaseLock();
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
    SpreadsheetApp.flush(); lock.releaseLock();
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
  try { sh.appendRow(t.head.map(h => Object.prototype.hasOwnProperty.call(o, h) ? o[h] : '')); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
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
