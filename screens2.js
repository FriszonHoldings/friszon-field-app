function intOk(v) { return v !== '' && v !== undefined && v !== null && /^\d+$/.test(String(v)); }
function missingHtml(m, fn) { const shown = S.showAllMissing ? m : m.slice(0, 2); return m.length ? 'Still needed: ' + shown.map(esc).join(' · ') + (m.length > shown.length ? ` <u onclick="S.showAllMissing=true;${fn}()">+${m.length - shown.length} more</u>` : '') : ''; }
function shotInto(obj, key, after, stampKey) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => { const file = input.files && input.files[0]; if (!file) return; try { obj[key] = await compress(file); if (stampKey) obj[stampKey] = new Date().toISOString(); after(); } catch (e) { logClient('error', 'photo', String(e)); toast('Photo failed. Try again.'); } };
  input.click();
}
function shotBlock(obj, key, call) { const v = obj[key]; return `<div class="photo">${v ? `<img src="${v}">` : ''}<button class="btn small ${v ? 'ghost' : ''}" onclick="${call}">${v ? 'Retake photo' : 'Take photo'}</button></div>`; }
function plainName(sku) { const p = (S.data && S.data.products || []).find(x => x.sku === sku); return p ? p.name + (p.pack ? ' (' + p.pack + ')' : '') : sku; }
function sentOf(type) { return (S.sentLog || []).filter(x => x.type === type); }
function queuedOf(type) { return S.outbox.filter(o => o.type === type); }

/* ---------- Stock Received ---------- */
function pendingDispatches() {
  const done = {};
  queuedOf('receipt').forEach(o => { done[o.payload.dispatch_id] = 1; });
  sentOf('receipt').forEach(x => { done[x.dispatch_id] = 1; });
  return (S.data && S.data.dispatches || []).filter(d => !done[d.dispatch_id]);
}
function stockMenuText() { const n = pendingDispatches().length; return n ? n + ' dispatch' + (n > 1 ? 'es' : '') + ' to receive' : 'Nothing waiting to be received'; }
async function openStock() {
  const draft = await ffGet('rcDraft');
  if (draft && pendingDispatches().some(d => d.dispatch_id === draft.dispatch_id)) { S.rc = draft; S.view = 'receipt'; } else S.view = 'stock';
  render(); window.scrollTo(0, 0);
}
function renderStock() {
  const list = pendingDispatches();
  $app.innerHTML = topBar('Stock Received', 'menu()') + `<main>${list.length ? list.map(d => `<button class="shop" onclick="startReceipt('${esc(d.dispatch_id)}')"><div class="name">Dispatch ${esc(d.dispatch_id)}</div><div class="meta">Sent ${esc(d.dispatch_date)} · ${d.lines.reduce((a, l) => a + l.qty, 0)} packs · ${d.lines.length} product${d.lines.length > 1 ? 's' : ''}</div></button>`).join('') : '<div class="empty">No stock waiting to be received.<br><br>When the office sends you stock it appears here. Record it the same day it reaches you.</div>'}</main>`;
  renderHeaderStatus();
}
function startReceipt(id) { S.showAllMissing = false; S.rc = {receipt_id: 'RC' + uid(), dispatch_id: id, all_ok: null, recv: {}, dmg: {}, boxes_photo: '', damage_photo: '', confirm: false}; rcDraft(); S.view = 'receipt'; render(); window.scrollTo(0, 0); }
function rcDraft() { clearTimeout(rcDraft.t); rcDraft.t = setTimeout(() => ffSet('rcDraft', S.rc), 300); }
function rcDispatch() { return (S.data.dispatches || []).find(d => d.dispatch_id === S.rc.dispatch_id) || {lines: []}; }
function rcValidate() {
  const r = S.rc, m = [], d = rcDispatch();
  if (r.all_ok === null) m.push('Did everything arrive correctly? Yes or No');
  if (r.all_ok === false) {
    d.lines.forEach(l => {
      const rv = r.recv[l.sku], dm = r.dmg[l.sku];
      if (!intOk(rv)) m.push(plainName(l.sku) + ' – packs received');
      if (!intOk(dm)) m.push(plainName(l.sku) + ' – packs damaged (0 if none)');
      if (intOk(rv) && intOk(dm) && Number(dm) > Number(rv)) m.push(plainName(l.sku) + ' – damaged cannot be more than received');
    });
    if (d.lines.every(l => intOk(r.recv[l.sku]) && Number(r.recv[l.sku]) === l.qty && Number(r.dmg[l.sku]) === 0)) m.push('Everything matches what was sent – tap Yes instead');
    if (!r.damage_photo) m.push('Photo of the problem');
  }
  if (!r.boxes_photo) m.push('Photo of the boxes as received');
  if (!r.confirm) m.push('Tick that you checked the boxes yourself');
  return m;
}
function rcMissing() { const el = document.getElementById('missing'); if (!el) return; const m = rcValidate(); el.innerHTML = missingHtml(m, 'rcMissing'); document.getElementById('savebtn').textContent = m.length ? 'Save (' + m.length + ' to fill)' : 'Save stock received'; }
function rcSet(k, v, re) { S.rc[k] = v; rcDraft(); if (re) renderReceipt(true); else rcMissing(); }
function rcNum(kind, sku, v) { S.rc[kind][sku] = v.replace(/[^0-9]/g, ''); rcDraft(); rcMissing(); }
function renderReceipt(keep) {
  const y = window.scrollY, r = S.rc, d = rcDispatch();
  let h = topBar('Stock Received', 'cancelReceipt()') + `<main><div class="card"><h2>Dispatch ${esc(d.dispatch_id)}</h2><div class="small">Sent ${esc(d.dispatch_date)}</div>
    ${d.lines.map(l => `<div class="row"><div class="label">${esc(plainName(l.sku))}</div><b>${l.qty}</b></div>`).join('')}
    <div class="row"><div class="label"><b>Total packs sent</b></div><b>${d.lines.reduce((a, l) => a + l.qty, 0)}</b></div></div>
    <div class="card"><h2>Check the boxes before you answer</h2><div class="small">Count every pack and look for damage.</div><br>
    <div class="choices"><button class="${r.all_ok === true ? 'on' : ''}" onclick="rcSet('all_ok',true,true)">Yes – all received, none damaged</button><button class="${r.all_ok === false ? 'on' : ''}" onclick="rcSet('all_ok',false,true)">No – short or damaged</button></div></div>`;
  if (r.all_ok === false) {
    h += `<div class="card"><h2>What actually arrived</h2><div class="small">Received = packs that reached you, including damaged ones.</div>${d.lines.map(l => `<div class="line"><div class="top"><span><b>${esc(plainName(l.sku))}</b></span><span>sent ${l.qty}</span></div>
      <div class="row"><div class="label">Received</div><input class="text" style="width:90px" inputmode="numeric" value="${esc(r.recv[l.sku] || '')}" oninput="rcNum('recv','${l.sku}',this.value)"></div>
      <div class="row"><div class="label">Damaged</div><input class="text" style="width:90px" inputmode="numeric" value="${esc(r.dmg[l.sku] || '')}" oninput="rcNum('dmg','${l.sku}',this.value)"></div></div>`).join('')}
      <label class="field">Photo of the problem (short box or damaged packs)</label>${shotBlock(r, 'damage_photo', "shotInto(S.rc,'damage_photo',()=>{rcDraft();renderReceipt(true)})")}</div>`;
  }
  h += `<div class="card"><label class="field">Photo of the boxes as received</label>${shotBlock(r, 'boxes_photo', "shotInto(S.rc,'boxes_photo',()=>{rcDraft();renderReceipt(true)})")}
    <label class="check"><input type="checkbox" ${r.confirm ? 'checked' : ''} onchange="rcSet('confirm',this.checked)"> I checked these boxes myself today</label></div>`;
  h += `</main><div class="savebar"><div class="inner"><div class="missing" id="missing"></div><button class="btn" id="savebtn" onclick="saveReceipt()">Save stock received</button></div></div>`;
  $app.innerHTML = h; renderHeaderStatus(); rcMissing();
  if (keep) window.scrollTo(0, y);
}
async function cancelReceipt() { if ((S.rc.all_ok !== null || S.rc.boxes_photo) && !confirm('Leave without saving? What you entered will be lost.')) return; await ffSet('rcDraft', null); S.rc = null; S.view = 'stock'; render(); }
async function saveReceipt() {
  const m = rcValidate();
  if (m.length) { S.showAllMissing = true; rcMissing(); toast('Fill the items listed in red first'); return; }
  const r = S.rc, d = rcDispatch();
  const recv = {}, dmg = {};
  if (r.all_ok === false) d.lines.forEach(l => { recv[l.sku] = Number(r.recv[l.sku]); dmg[l.sku] = Number(r.dmg[l.sku]); });
  const payload = {receipt_id: r.receipt_id, dispatch_id: r.dispatch_id, all_ok: r.all_ok, recv: recv, dmg: dmg, boxes_photo: r.boxes_photo, damage_photo: r.all_ok ? '' : r.damage_photo, confirm: true, saved_at: new Date().toISOString()};
  await ffOutboxPut({id: r.receipt_id, type: 'receipt', payload: payload, created: Date.now(), label: 'Stock received – dispatch ' + r.dispatch_id + (r.all_ok ? '' : ' (short/damaged)')});
  await ffSet('rcDraft', null); S.rc = null;
  await refreshOutbox(); toast('Stock received saved ✓'); S.view = 'due'; render(); syncNow();
}

/* ---------- Month Close ---------- */
function mcInfo() { return (S.data && S.data.monthClose) || {month: '', label: '', open: false, done: false, opens: ''}; }
function mcDone() { const i = mcInfo(); return !!(i.done || queuedOf('monthclose').some(o => o.payload.month === i.month) || sentOf('monthclose').some(x => x.month === i.month)); }
function monthCloseMenuText() { const i = mcInfo(); if (!i.month) return ''; if (mcDone()) return i.label + ' done ✓'; return i.open ? 'Due now for ' + i.label + ' – by the 5th' : 'Opens ' + i.opens + ' (1st to 5th)'; }
async function openMonthClose() {
  const i = mcInfo(), draft = await ffGet('mcDraft');
  S.showAllMissing = false;
  S.mc = draft && draft.month === i.month ? draft : {monthclose_id: 'MC' + uid(), month: i.month, verdict: '', what_is_wrong: '', stock: {}, confirm: false};
  S.view = 'monthclose'; render(); window.scrollTo(0, 0);
}
function mcDraft() { clearTimeout(mcDraft.t); mcDraft.t = setTimeout(() => ffSet('mcDraft', S.mc), 300); }
function mcSkus() { return (S.data.products || []).map(p => p.sku); }
function mcValidate() {
  const c = S.mc, m = [];
  if (!c.verdict) m.push('Agree or Disagree with the statement');
  if (c.verdict === 'Disagree' && String(c.what_is_wrong).trim().length < 5) m.push('Write exactly what is wrong');
  const miss = mcSkus().filter(s => !intOk(c.stock[s]));
  if (miss.length) m.push(miss.length + ' product count' + (miss.length > 1 ? 's' : '') + ' (0 if none)');
  if (!c.confirm) m.push('Tick that you counted every pack yourself');
  return m;
}
function mcMissing() { const el = document.getElementById('missing'); if (!el) return; const m = mcValidate(); el.innerHTML = missingHtml(m, 'mcMissing'); document.getElementById('savebtn').textContent = m.length ? 'Save (' + m.length + ' to fill)' : 'Submit Month Close'; }
function mcSet(k, v, re) { S.mc[k] = v; mcDraft(); if (re) renderMonthClose(true); else mcMissing(); }
function mcNum(sku, v) { S.mc.stock[sku] = v.replace(/[^0-9]/g, ''); mcDraft(); const el = document.getElementById('mc-' + sku); if (el) el.classList.toggle('blank', S.mc.stock[sku] === ''); mcMissing(); }
function renderMonthClose(keep) {
  const y = window.scrollY, i = mcInfo(), c = S.mc;
  let h = topBar('Month Close', 'menu()') + '<main>';
  if (mcDone()) h += `<div class="ok">Month Close for ${esc(i.label)} is done ✓</div><div class="small" style="text-align:center">Next one opens on ${esc(i.opens)}.</div>`;
  else if (!i.open) h += `<div class="card"><h2>Not open now</h2>Month Close opens on <b>${esc(i.opens)}</b> and must be done by the 5th.<br><br><span class="small">Between the 1st and 5th you will check last month's statement from your Reporting Manager and count every pack in your own bag.</span></div>`;
  else {
    h += `<div class="card"><h2>1. Statement for ${esc(i.label)}</h2><div class="small">Check the statement your Reporting Manager sent you.</div><br>
      <div class="choices"><button class="${c.verdict === 'Agree' ? 'on' : ''}" onclick="mcSet('verdict','Agree',true)">Agree</button><button class="${c.verdict === 'Disagree' ? 'on' : ''}" onclick="mcSet('verdict','Disagree',true)">Disagree</button></div>
      ${c.verdict === 'Disagree' ? `<label class="field">What exactly is wrong?</label><textarea oninput="mcSet('what_is_wrong',this.value)">${esc(c.what_is_wrong)}</textarea>` : ''}</div>
      <div class="card"><h2>2. Count every pack in your bag</h2><div class="small">Type the number for each product. 0 if none. Every box must be filled.</div>
      ${mcSkus().map(s => `<div class="row"><div class="label">${esc(plainName(s))}</div><input id="mc-${s}" class="text ${intOk(c.stock[s]) ? '' : 'blank'}" style="width:90px;text-align:center" inputmode="numeric" value="${esc(c.stock[s] === undefined ? '' : c.stock[s])}" oninput="mcNum('${s}',this.value)"></div>`).join('')}
      <label class="check"><input type="checkbox" ${c.confirm ? 'checked' : ''} onchange="mcSet('confirm',this.checked)"> I counted every pack in my bag myself</label></div>`;
  }
  h += '</main>';
  if (!mcDone() && i.open) h += `<div class="savebar"><div class="inner"><div class="missing" id="missing"></div><button class="btn" id="savebtn" onclick="saveMonthClose()">Submit Month Close</button></div></div>`;
  $app.innerHTML = h; renderHeaderStatus(); if (!mcDone() && i.open) mcMissing();
  if (keep) window.scrollTo(0, y);
}
async function saveMonthClose() {
  const m = mcValidate();
  if (m.length) { S.showAllMissing = true; mcMissing(); toast('Fill the items listed in red first'); return; }
  if (!confirm('Submit Month Close? It cannot be changed afterwards.')) return;
  const c = S.mc, stock = {};
  mcSkus().forEach(s => { stock[s] = Number(c.stock[s]); });
  const payload = {monthclose_id: c.monthclose_id, month: c.month, verdict: c.verdict, what_is_wrong: c.verdict === 'Disagree' ? c.what_is_wrong.trim() : '', stock: stock, confirm: true, saved_at: new Date().toISOString()};
  await ffOutboxPut({id: c.monthclose_id, type: 'monthclose', payload: payload, created: Date.now(), label: 'Month Close – ' + mcInfo().label});
  await ffSet('mcDraft', null); S.mc = null;
  await refreshOutbox(); toast('Month Close saved ✓'); S.view = 'due'; render(); syncNow();
}

/* ---------- Prospects ---------- */
const PQ = {
  q1_premium_section: {t: 'Q1 · Premium section', h: 'At least one shelf of premium, organic or gourmet food? Wholesale shop, cheap brands only, office-only street, or a chain branch = No. No rejects the shop.', o: ['Yes', 'No']},
  q2_premium_products: {t: 'Q2 · Premium products', h: 'Across masalas, pickles, spreads, sauces, ready mixes, honey and oils: count products whose price per 100 g is DOUBLE an ordinary brand of the same kind, and fresh (packed in the last 3 months, not dusty). 0 or 1 rejects the shop.', o: ['0 or 1', '2', '3 or 4', '5 or more']},
  q3_crowded_shelf: {t: 'Q3 · Crowded shelf', h: '4 or more small, local or homemade-style podi / masala brands on that shelf? Big brands (MTR, Aachi, Everest) do not count.', o: ['Yes', 'No']},
  q4_storage: {t: 'Q4 · Storage', h: 'At the exact spot our packs would sit: any sunlight, heat source, damp or musty smell, insects or rat droppings? Any one rejects the shop.', o: ['No problem', 'Sunlight heat damp or pests']},
  q5_shopper_match: {t: 'Q5 · Shopper match', h: 'South Indian staples (idli rice, urad dal, sambar powder, curry leaves) and gourmet / organic / imported food?', o: ['Both', 'South Indian only', 'Gourmet only', 'Neither']},
  q6_fresh_items: {t: 'Q6 · Fresh items', h: 'Sells vegetables, fruit, milk, curd, or bread?', o: ['Yes', 'No']},
  q7_catchment: {t: 'Q7 · Catchment (10-minute walk around)', h: 'Good signs: affluent homes · families who cook (schools, parks, children) · community fit (temples, South Indian or other-state restaurants). If offices or low-income housing dominate, choose the last option.', o: ['All 3 good signs', 'Families + 1 more good sign', 'Mostly PG or hostels', 'Families, but no other good sign', 'Mostly offices or poor housing']},
  q8_community: {t: 'Q8 · Community', h: 'Who are most of the customers? Ask the owner or staff.', o: ['South Indian', 'Cosmopolitan', 'Mixed', 'PG or hostel belt']},
  q9_shop_type: {t: 'Q9 · Shop type', h: 'Supermarket = self-service, baskets, several aisles. Premium kirana = counter service with some premium items.', o: ['Supermarket', 'Organic or health store', 'Mid-market with premium section', 'Premium kirana', 'Gated-community store']},
  q11_terms: {t: 'Q11 · Terms agreed', h: 'Explain: 30% on every pack · pays only for what sold (when half sold or after 30 days) · no listing or display fee · start with 4 packs of 5 products · older packs in front, near-expiry swapped. Owner agrees to ALL? No stops here. Never offer anything extra.', o: ['Yes', 'No']},
  q12_checks: {t: 'Q12 · Checks agreed', h: 'Owner agrees to: count + shelf photo every visit · one signed and stamped sheet every month · payment only to Friszon QR or bank. Yes only if the owner agrees to all three and the shop has a licence (GST / FSSAI / trade) and a shop stamp. No stops here.', o: ['Yes', 'No']},
  q13_shelf: {t: 'Q13 · Shelf offered', h: 'Where will our 5 products go? Eye level = chest to eyes, hand level = waist to chest. Bottom shelf (below knee) stops here.', o: ['Eye or hand level, all facing front', 'Lower shelf, but all visible', 'Bottom shelf only']},
  q14_owner: {t: 'Q14 · Owner', h: 'Ask: will you recommend our podi? Can we do a free tasting on a weekend morning? Added a new small brand in the last 6 months (ask to see it)?', o: ['Keen, yes to all 3', 'Keen, but said no to one', 'Not interested']},
  q15_reliability: {t: 'Q15 · Reliability', h: 'Open 1+ year · shelf prices at MRP · pays suppliers on time (ask another supplier quietly) · owner around during visit hours.', o: ['All good', 'Some doubts', 'Red flags']},
  q16_linked_to_rep: {t: 'Q16 · Linked to you', h: 'Owned or run by your family, relatives or friends, or any money dealings with you? Answer honestly – telling us is fine, hiding it is not.', o: ['No', 'Yes']},
  q17_opening_order: {t: 'Q17 · Opening order', h: 'Standard = 4 packs each of 5 products. Smaller only for a small kirana or gated-community store, and needs company approval.', o: ['Standard 20 packs', 'Smaller order requested']}
};
const F1Q = ['q1_premium_section', 'q2_premium_products', 'q3_crowded_shelf', 'q4_storage', 'q5_shopper_match', 'q6_fresh_items', 'q7_catchment', 'q8_community', 'q9_shop_type'];
const F3Q = ['q11_terms', 'q12_checks', 'q13_shelf', 'q14_owner', 'q15_reliability', 'q16_linked_to_rep', 'q17_opening_order'];
const OPENING_MIX = {'South Indian': ['DAL', 'IDLI', 'CURRY', 'WSAMBAR', 'KING'], 'Mixed': ['DAL', 'IDLI', 'CURRY', 'WSAMBAR', 'KING'], 'Cosmopolitan': ['KING', 'QUEEN', 'DAL', 'GARLIC', 'MORINGA'], 'PG or hostel belt': ['DAL', 'IDLI', 'GARLIC', 'CURRY', 'MORINGA']};
function f1Stop(a) { return a.q1_premium_section === 'No' || a.q2_premium_products === '0 or 1' || a.q4_storage === 'Sunlight heat damp or pests'; }
function f3Stop(a) { return a.q11_terms === 'No' || a.q12_checks === 'No' || a.q13_shelf === 'Bottom shelf only'; }
function visibleQs(keys, a, stop) { const out = []; for (const k of keys) { out.push(k); if (stop(a) && keys.slice(0, keys.indexOf(k) + 1).some(x => (x === 'q1_premium_section' && a[x] === 'No') || (x === 'q2_premium_products' && a[x] === '0 or 1') || (x === 'q4_storage' && a[x] === 'Sunlight heat damp or pests') || (x === 'q11_terms' && a[x] === 'No') || (x === 'q12_checks' && a[x] === 'No') || (x === 'q13_shelf' && a[x] === 'Bottom shelf only'))) break; } return out; }

function myProspects() {
  const by = {};
  (S.data && S.data.prospects || []).forEach(p => { by[p.prospect_id] = Object.assign({}, p); });
  const local = p => { if (!by[p.prospect_id]) by[p.prospect_id] = Object.assign({result: '', decision: '', has_f2: false, has_f3: false, local: true}, p); };
  sentOf('prospect').filter(x => x.prospect).forEach(x => local(x.prospect));
  queuedOf('prospect').filter(o => o.payload.stage === 'f1').forEach(o => local({prospect_id: o.payload.prospect_id, shop_name: o.payload.shop_name, pincode: o.payload.pincode, created_at: o.payload.saved_at, q8_community: o.payload.answers.q8_community || '', q9_shop_type: o.payload.answers.q9_shop_type || '', stop: !!o.payload.stop, unsent: true}));
  const pend = st => { const s = {}; queuedOf('prospect').filter(o => o.payload.stage === st).forEach(o => { s[o.payload.prospect_id] = 'q'; }); sentOf('prospect').filter(x => x.stage === st).forEach(x => { s[x.prospect_id] = s[x.prospect_id] || 's'; }); return s; };
  const p2 = pend('f2'), p3 = pend('f3');
  return Object.keys(by).map(k => { const p = by[k]; p.f2 = p.has_f2 || !!p2[k]; p.f3 = p.has_f3 || !!p3[k]; return p; }).sort((a, b) => (b.created_at || '') < (a.created_at || '') ? -1 : 1);
}
function prospectState(p) {
  const r = p.result || '';
  if (p.decision === 'Approve') return {c: 'ok', t: 'Approved' + (p.shop_id ? ' – now on your shop list (' + p.shop_id + ')' : ' – being set up as a shop')};
  if (p.decision === 'Reject') return {c: 'red', t: 'Company decision: Reject' + (p.decision_note ? ' – ' + p.decision_note : '')};
  if (p.decision === 'Hold') return {c: 'amber', t: 'Company decision: Hold' + (p.decision_note ? ' – ' + p.decision_note : '')};
  if (p.stop || /^Reject/.test(r)) return {c: 'red', t: r || 'Rejected in Form 1 – no further steps'};
  if (p.f3) return {c: 'amber', t: (r && !/^In progress/.test(r) ? r + ' · ' : '') + 'Waiting for the company decision. Do not give stock yet.'};
  if (!p.f2) return {c: 'amber', t: 'Next: footfall count (Q10), working day 6–8 pm', act: 'f2'};
  if (/GO - meet the owner/.test(r) || (S.data && S.data.test && !/STOP/.test(r))) return {c: 'ok', t: 'GO – meet the owner and answer Q11–Q17', act: 'f3'};
  return {c: 'amber', t: 'Footfall sent. Result in about 10 minutes – tap Refresh in the menu.'};
}
function prospectMenuText() { const a = myProspects().filter(p => prospectState(p).act).length; return a ? a + ' prospect' + (a > 1 ? 's need' : ' needs') + ' your next step' : 'Add and score a new shop'; }
function openProspects() { S.view = 'prospects'; render(); window.scrollTo(0, 0); }
function renderProspects() {
  const list = myProspects();
  $app.innerHTML = topBar('New shops', 'menu()') + `<main><button class="btn" onclick="newProspect()">+ Add a new shop</button><br>
    <div class="small">Never give stock to a shop until the company approves it.</div><br>
    ${list.length ? list.map(p => { const s = prospectState(p); return `<button class="shop" onclick="${s.act ? `openProspectStage('${esc(p.prospect_id)}','${s.act}')` : ''}"><div class="name">${esc(p.shop_name)}</div><div class="meta">${esc(p.pincode || '')}${p.created_at ? ' · added ' + new Date(p.created_at).toLocaleDateString('en-IN') : ''}${p.unsent ? ' · not yet sent' : ''}${p.score !== '' && p.score !== undefined ? ' · score ' + esc(p.score) : ''}</div><span class="chip ${s.c === 'red' ? 'red' : s.c === 'amber' ? 'amber' : ''}">${esc(s.t)}</span></button>`; }).join('') : '<div class="empty">No prospects yet.</div>'}</main>`;
  renderHeaderStatus();
}
function prDraft() { clearTimeout(prDraft.t); prDraft.t = setTimeout(() => ffSet('prDraft', S.pr), 300); }
async function newProspect() {
  const d = await ffGet('prDraft');
  S.showAllMissing = false;
  S.pr = d && d.stage === 'f1' ? d : {prospect_id: 'PR' + uid(), stage: 'f1', shop_name: '', owner_name: '', owner_mobile: '', address: '', pincode: '', gstin: '', front_photo: '', q2_photo: '', answers: {}};
  S.view = 'prospect'; startGeo(); render(); window.scrollTo(0, 0);
}
async function openProspectStage(id, stage) {
  const p = myProspects().find(x => x.prospect_id === id) || {};
  const d = await ffGet('prDraft');
  S.showAllMissing = false;
  if (d && d.prospect_id === id && d.stage === stage) S.pr = d;
  else if (stage === 'f2') S.pr = {prospect_id: id, stage: 'f2', shop_name: p.shop_name, q10_footfall: ''};
  else S.pr = {prospect_id: id, stage: 'f3', shop_name: p.shop_name, answers: {}, products: (OPENING_MIX[p.q8_community] || []).slice()};
  S.view = 'prospect'; render(); window.scrollTo(0, 0);
}
function prSet(k, v, re) { S.pr[k] = v; prDraft(); if (re) renderProspect(true); else prMissing(); }
function prAns(k, v) { S.pr.answers[k] = v; prDraft(); renderProspect(true); }
function prProd(sku, on) { const a = S.pr.products; const i = a.indexOf(sku); if (on && i < 0) a.push(sku); if (!on && i > -1) a.splice(i, 1); prDraft(); renderProspect(true); }
function prValidate() {
  const p = S.pr, a = p.answers || {}, m = [];
  if (p.stage === 'f1') {
    if (p.shop_name.trim().length < 3) m.push('Shop name (as on the signboard)');
    if (p.owner_name.trim().length < 2) m.push('Owner name');
    if (!/^[6-9]\d{9}$/.test(p.owner_mobile)) m.push('Owner mobile – 10 digits');
    if (p.address.trim().length < 5) m.push('Address');
    if (!/^\d{6}$/.test(p.pincode)) m.push('Pincode – 6 digits');
    if (p.gstin && !/^[0-9A-Z]{15}$/.test(p.gstin)) m.push('GST number – 15 letters/digits, or leave blank');
    if (!S.geo) m.push('Location – stand at the shop and allow location');
    if (!p.front_photo) m.push('Photo of the shop front with signboard');
    visibleQs(F1Q, a, f1Stop).forEach(k => { if (!a[k]) m.push(PQ[k].t.split(' · ')[0]); });
    if (!f1Stop(a) && !p.q2_photo) m.push('Q2 photo – two premium products with price labels');
  } else if (p.stage === 'f2') {
    if (!intOk(p.q10_footfall)) m.push('Q10 – number of adults who walked in during the 15 minutes');
  } else {
    visibleQs(F3Q, a, f3Stop).forEach(k => { if (!a[k]) m.push(PQ[k].t.split(' · ')[0]); });
    if (!f3Stop(a) && a.q17_opening_order) {
      if (a.q17_opening_order === 'Standard 20 packs' && p.products.length !== 5) m.push('Choose exactly 5 products');
      if (!p.products.length || p.products.length > 5) m.push('Choose 1 to 5 products');
    }
  }
  return m;
}
function prMissing() { const el = document.getElementById('missing'); if (!el) return; const m = prValidate(); el.innerHTML = missingHtml(m, 'prMissing'); document.getElementById('savebtn').textContent = m.length ? 'Save (' + m.length + ' to fill)' : 'Save'; }
function qBlock(k, a) { const q = PQ[k]; return `<div class="line"><b>${esc(q.t)}</b><div class="small">${esc(q.h)}</div><div class="choices" style="margin-top:8px">${q.o.map(o => `<button class="${a[k] === o ? 'on' : ''}" onclick="prAns('${k}','${esc(o)}')">${esc(o)}</button>`).join('')}</div></div>`; }
function txt(k, label, mode, extra) { return `<label class="field">${label}</label><input class="text" ${mode ? 'inputmode="' + mode + '"' : ''} value="${esc(S.pr[k])}" oninput="prSet('${k}',${extra || 'this.value'})">`; }
function renderProspect(keep) {
  const y = window.scrollY, p = S.pr, a = p.answers || {};
    let h = topBar(p.stage === 'f1' ? 'New shop' : p.shop_name, 'cancelProspect()') + '<main>';
  if (p.stage === 'f1') {
    h += `<div class="card"><h2>Shop details</h2>${txt('shop_name', 'Shop name (exactly as on the signboard)')}${txt('owner_name', 'Owner name')}${txt('owner_mobile', 'Owner mobile', 'numeric', "this.value.replace(/[^0-9]/g,'').slice(0,10)")}
      <label class="field">Address</label><textarea oninput="prSet('address',this.value)">${esc(p.address)}</textarea>
      ${txt('pincode', 'Pincode', 'numeric', "this.value.replace(/[^0-9]/g,'').slice(0,6)")}${txt('gstin', 'GST number (if any)', '', "this.value.toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,15)")}
      <div class="small" id="geo" style="margin-top:8px">${geoText()}</div>
      <label class="field">Photo of the shop front, signboard readable</label>${shotBlock(p, 'front_photo', "shotInto(S.pr,'front_photo',()=>{prDraft();renderProspect(true)})")}</div>
      <div class="card"><h2>At the aisle – Q1 to Q9</h2><div class="small">Answer what you see. If unsure between two answers, choose the lower one.</div>`;
    visibleQs(F1Q, a, f1Stop).forEach(k => { h += qBlock(k, a); if (k === 'q2_premium_products' && !f1Stop(a)) h += `<label class="field">Q2 photo – two premium products with price labels</label>${shotBlock(p, 'q2_photo', "shotInto(S.pr,'q2_photo',()=>{prDraft();renderProspect(true)})")}`; });
    if (f1Stop(a)) h += `<div class="err">This shop does not qualify. Save to record it – no further steps.</div>`;
    h += `</div>`;
  } else if (p.stage === 'f2') {
    h += `<div class="card"><h2>Q10 · Footfall count</h2><div class="small">Working day, 6–8 pm. Stand where you can see the entrance and count every adult customer who walks in for 15 minutes. Do NOT count staff, delivery people, children, people coming back in, or passers-by. Count – never estimate.</div>
      <div class="row" style="margin-top:8px"><div class="label">Adults who walked in</div><div class="stepper"><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(p.q10_footfall)}" oninput="this.value=this.value.replace(/[^0-9]/g,'');prSet('q10_footfall',this.value)" id="q10n"></div></div>
      <div class="small" style="margin-top:6px">Type the total after the 15 minutes.</div></div>`;
  } else {
    h += `<div class="card"><h2>Meet the owner – Q11 to Q17</h2><div class="small">Explain each point in plain words. Never offer anything extra to get a Yes.</div>`;
    visibleQs(F3Q, a, f3Stop).forEach(k => {
      h += qBlock(k, a);
    });
    if (f3Stop(a)) h += `<div class="err">This shop does not qualify. Save to record it.</div>`;
    h += `</div>`;
    if (!f3Stop(a)) {
      const prods = (S.data.products || []).filter(x => !/15$/.test(x.sku));
      h += `<div class="card"><h2>Opening products</h2><div class="small">Pre-filled from the community (Q8). Change only if the owner asks. ${p.products.length} chosen.</div>${prods.map(x => `<label class="check"><input type="checkbox" ${p.products.indexOf(x.sku) > -1 ? 'checked' : ''} onchange="prProd('${x.sku}',this.checked)"> ${esc(plainName(x.sku))}</label>`).join('')}</div>`;
    }
  }
  h += `</main><div class="savebar"><div class="inner"><div class="missing" id="missing"></div><button class="btn" id="savebtn" onclick="saveProspect()">Save</button></div></div>`;
  $app.innerHTML = h; renderHeaderStatus(); prMissing();
  if (keep) window.scrollTo(0, y);
}
async function cancelProspect() {
  const p = S.pr;
  const started = p.stage === 'f1' ? (p.shop_name || p.front_photo) : p.stage === 'f2' ? p.q10_footfall : Object.keys(p.answers || {}).length;
  if (started && !confirm('Leave? Your answers stay saved on this phone until you start another one.')) return;
  stopGeo(); S.pr = null; S.view = 'prospects'; render();
}
async function saveProspect() {
  const m = prValidate();
  if (m.length) { S.showAllMissing = true; prMissing(); toast('Fill the items listed in red first'); return; }
  const p = S.pr, a = p.answers || {};
  let payload, label;
  if (p.stage === 'f1') {
    const ans = {}; visibleQs(F1Q, a, f1Stop).forEach(k => { ans[k] = a[k]; });
    const g = S.geo;
    payload = {prospect_id: p.prospect_id, stage: 'f1', shop_name: p.shop_name.trim(), owner_name: p.owner_name.trim(), owner_mobile: p.owner_mobile, address: p.address.trim(), pincode: p.pincode, gstin: p.gstin, gps: g.lat.toFixed(6) + ', ' + g.lng.toFixed(6), gps_accuracy: g.accuracy, front_photo: p.front_photo, q2_photo: f1Stop(a) ? '' : p.q2_photo, answers: ans, stop: f1Stop(a), saved_at: new Date().toISOString()};
    label = 'New shop – ' + payload.shop_name + ' (Q1–Q9)';
  } else if (p.stage === 'f2') {
    payload = {prospect_id: p.prospect_id, stage: 'f2', q10_footfall: Number(p.q10_footfall), saved_at: new Date().toISOString()};
    label = p.shop_name + ' – footfall ' + p.q10_footfall + ' (Q10)';
  } else {
    if (!confirm('Save the owner answers? They cannot be changed afterwards.')) return;
    const ans = {}; visibleQs(F3Q, a, f3Stop).forEach(k => { ans[k] = a[k]; });
    payload = {prospect_id: p.prospect_id, stage: 'f3', answers: ans, products: f3Stop(a) ? [] : p.products.slice(), saved_at: new Date().toISOString()};
    label = p.shop_name + ' – owner answers (Q11–Q17)';
  }
  await ffOutboxPut({id: p.prospect_id + '.' + p.stage, type: 'prospect', payload: payload, created: Date.now(), label: label});
  stopGeo();
  await ffSet('prDraft', null); S.pr = null;
  await refreshOutbox(); toast('Saved ✓'); S.view = 'prospects'; render(); syncNow();
}
