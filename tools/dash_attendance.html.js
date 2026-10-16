const ATT_FROM_D = '2026-10-15';
function attRowsAll() {
  const real = (D.T.APP_Attendance || []).filter(r => r.att_id);
  const test = S.attTest ? (D.T.TEST_APP_Attendance || []).filter(r => r.att_id).map(r => Object.assign(r, {_test: true})) : [];
  return real.concat(test);
}
function attPendingAll() { return attRowsAll().filter(r => String(r.status) === 'Pending'); }
function attGps(g) { const p = String(g || '').split(',').map(x => Number(String(x).trim())); return p.length === 2 && isFinite(p[0]) && isFinite(p[1]) && !(p[0] === 0 && p[1] === 0) ? p : null; }
function attWhen(r) { return hm(r.event_time); }
function attBits(r, label) {
  if (!r) return '';
  const p = attGps(r.gps);
  return '<a class="link" data-photo="' + esc(r.selfie) + '" data-cap="' + esc(label + ' selfie · ' + dlab(dk(r.event_time)) + ' ' + attWhen(r)) + '">selfie</a> · ' + (p ? mapLink(p) : '<span class="pill red">no location</span>');
}
function attLbl(rule) { return {'Late': 'late', 'Early': 'early', 'Missed mark-out': 'missed mark-out', 'Late, missed mark-out': 'late + missed mark-out'}[rule] || 'early'; }
function attPill(r) {
  const st = String(r.status), rule = String(r.rule);
  if (st === 'Pending') return ' <span class="pill amber">' + attLbl(rule) + ' – waiting</span>';
  if (st === 'Approved') return ' <span class="pill amber">' + attLbl(rule) + ' – approved</span>';
  if (st === 'Rejected') return ' <span class="pill red">' + attLbl(rule) + ' – rejected</span>';
  return '';
}
function attReqHtml(r) {
  const rep = repOf(low(r.rep_email)) || {};
  const id = String(r.att_id);
  const what = String(r.kind) === 'IN' ? ({'Missed mark-out': 'Mark-in after a missed mark-out', 'Late, missed mark-out': 'Late mark-in after a missed mark-out'}[String(r.rule)] || 'Late mark-in') : 'Early mark-out';
  const skew = Math.abs(num(r.clock_skew_sec)) > 120 ? '<div class="small" style="color:var(--red)">Phone clock was ' + Math.round(Math.abs(num(r.clock_skew_sec)) / 60) + ' min off – time corrected to the office clock.</div>' : '';
  return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px">' +
    '<div><b>' + esc(rep.name || r.rep_email) + '</b>' + (r._test ? ' <span class="pill mute">TEST</span>' : '') + ' – ' + what + ' at <b>' + attWhen(r) + '</b>, ' + dlab(dk(r.event_time)) + '</div>' +
    '<div class="small">Reason: ' + esc(r.reason || '–') + '</div><div class="small">' + attBits(r, what) + '</div>' + skew +
    '<div class="row" style="margin-top:8px"><input id="attn-' + esc(id) + '" placeholder="Note for him (optional)" style="flex:1;min-width:180px">' +
    '<button class="btn" data-attdo="Approved" data-attid="' + esc(id) + '" data-atttest="' + (r._test ? '1' : '') + '">Approve</button>' +
    '<button class="btn" data-attdo="Rejected" data-attid="' + esc(id) + '" data-atttest="' + (r._test ? '1' : '') + '">Reject</button></div>' +
    '<div class="small muted" id="attm-' + esc(id) + '"></div></div>';
}
function attBadge() {
  const b = document.querySelector('#tabs button[data-t="att"]');
  if (!b || !D) return;
  const n = attPendingAll().length;
  b.textContent = 'Attendance' + (n ? ' (' + n + ' waiting)' : '');
}
function viewAtt() {
  const e = S.rep, rep = repOf(e) || {};
  const pend = attPendingAll();
  let h = '<div class="card"><h3>Waiting for your approval <span class="pill ' + (pend.length ? 'red' : 'good') + '">' + pend.length + '</span><span class="sp small muted"><label><input type="checkbox" id="attTest"' + (S.attTest ? ' checked' : '') + '> show test entries</label></span></h3><div class="body">';
  h += pend.length ? pend.map(attReqHtml).join('') : '<div class="muted">Nothing waiting. Late mark-ins (after 10 am) and early mark-outs (before 6 pm) appear here, and you also get an email for each.</div>';
  h += '</div></div>';
  h += rangeControls('<span class="muted small" style="align-self:flex-end">' + esc(rep.name || e) + ' · attendance from ' + dlab(ATT_FROM_D) + '</span>');
  const mine = attRowsAll().filter(r => low(r.rep_email) === e);
  const byDay = {};
  mine.forEach(r => { const k = dk(r.att_date) || dk(r.event_time); (byDay[k] = byDay[k] || []).push(r); });
  const keys = [];
  for (let k = S.to, n = 0; k >= S.from && n < 400; k = addDays(k, -1), n++) if (byDay[k] || (dow(k) !== 0 && k >= ATT_FROM_D && k <= todayKey())) keys.push(k);
  let worked = 0, absent = 0, late = 0, early = 0, mins = 0, paired = 0;
  const rows = keys.map(k => {
    const rs = (byDay[k] || []).slice().sort((a, b) => String(a.event_time) < String(b.event_time) ? -1 : 1);
    const inR = rs.filter(r => String(r.kind) === 'IN').pop() || null;
    const outR = rs.filter(r => String(r.kind) === 'OUT' && String(r.status) !== 'Rejected').pop() || null;
    const rejOut = rs.filter(r => String(r.kind) === 'OUT' && String(r.status) === 'Rejected');
    const isAbsent = !inR || String(inR.status) === 'Rejected';
    const m = inR && outR && !isAbsent ? Math.max(0, Math.round((new Date(outR.event_time) - new Date(inR.event_time)) / 60000)) : null;
    if (!isAbsent) worked++;
    else if (k < todayKey() || inR) absent++;
    if (inR && /Late/.test(String(inR.rule))) late++;
    if (rs.some(r => String(r.rule) === 'Early')) early++;
    if (m !== null) { mins += m; paired++; }
    const notes = [];
    rs.forEach(r => {
      if (String(r.reason || '').trim()) notes.push((String(r.kind) === 'IN' ? 'In: ' : 'Out: ') + esc(r.reason) + (r.decision_note ? ' <span class="muted">(your note: ' + esc(r.decision_note) + ')</span>' : ''));
      if (Math.abs(num(r.clock_skew_sec)) > 120) notes.push('<span style="color:var(--red)">Phone clock ' + Math.round(Math.abs(num(r.clock_skew_sec)) / 60) + ' min off at ' + (String(r.kind) === 'IN' ? 'mark-in' : 'mark-out') + '</span>');
    });
    rejOut.forEach(r => notes.push('Early mark-out at ' + attWhen(r) + ' rejected'));
    return {_id: k, _k: k, inR: inR, outR: outR, absent: isAbsent, m: m, notes: notes.join('<br>'), test: rs.some(r => r._test)};
  });
  h += '<div class="tiles">' + tile('Days marked in', worked) + tile('Absent', absent, 'Mon–Sat, no approved mark-in', absent ? 'red' : '') + tile('Late mark-ins', late, '', late ? 'red' : '') + tile('Early mark-outs', early, '', early ? 'red' : '') + tile('Average day', paired ? Math.floor(mins / paired / 60) + ' h ' + Math.round(mins / paired % 60) + ' m' : '–', paired ? 'over ' + paired + ' full day(s)' : '') + '</div>';
  const cols = [
    {k: '_k', l: 'Day', nw: 1, f: r => dlab(r._k) + (r.test ? ' <span class="pill mute">TEST</span>' : ''), sv: r => r._k},
    {k: 'in', l: 'Mark in', f: r => r.inR ? '<b>' + attWhen(r.inR) + '</b>' + attPill(r.inR) + '<div class="small">' + attBits(r.inR, 'Mark-in') + '</div>' : (r._k === todayKey() ? '<span class="pill amber">not yet</span>' : '<span class="pill red">absent</span>'), sv: r => r.inR ? String(r.inR.event_time) : ''},
    {k: 'out', l: 'Mark out', f: r => r.outR ? '<b>' + attWhen(r.outR) + '</b>' + attPill(r.outR) + '<div class="small">' + attBits(r.outR, 'Mark-out') + '</div>' : (r.inR && !r.absent ? (r._k === todayKey() ? '<span class="pill amber">not yet</span>' : '<span class="pill red">no mark-out</span>') : ''), sv: r => r.outR ? String(r.outR.event_time) : ''},
    {k: 'm', l: 'Hours', n: 1, f: r => r.m === null ? '' : Math.floor(r.m / 60) + ' h ' + (r.m % 60) + ' m', sv: r => r.m || 0},
    {k: 'notes', l: 'Reasons and notes', f: r => r.notes || '', sv: r => r.notes || ''}
  ];
  h += '<div class="card"><h3>Day by day</h3><div class="tw">' + table('att', cols, rows, {empty: 'No attendance in this range. Attendance starts ' + dlab(ATT_FROM_D) + '.'}) + '</div></div>';
  return h;
}
document.addEventListener('change', ev => { if (ev.target && ev.target.id === 'attTest') { S.attTest = ev.target.checked; render(); } });
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-attdo]');
  if (!b) return;
  ev.preventDefault();
  const id = b.dataset.attid, dec = b.dataset.attdo, test = b.dataset.atttest === '1';
  const noteEl = document.getElementById('attn-' + id), msg = document.getElementById('attm-' + id);
  const btns = Array.from(document.querySelectorAll('[data-attdo]')).filter(x => x.dataset.attid === id);
  btns.forEach(x => { x.disabled = true; });
  if (msg) msg.textContent = 'Saving…';
  google.script.run.withSuccessHandler(s => {
    const r = JSON.parse(s);
    attRowsAll().filter(x => String(x.att_id) === id).forEach(x => { x.status = r.status; x.decided_at = r.decided_at; x.decision_note = r.decision_note; });
    render();
  }).withFailureHandler(err => {
    if (msg) msg.textContent = 'Could not save: ' + (err.message || err);
    btns.forEach(x => { x.disabled = false; });
  }).attDecideDash(id, dec, noteEl ? noteEl.value : '', test);
});
