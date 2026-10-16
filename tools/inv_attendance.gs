function attendanceFlags_(o) {
  const tz = 'Asia/Kolkata';
  const asDate = d => d instanceof Date ? d : (d ? new Date(d) : null);
  const t = d => { const x = asDate(d); return x && !isNaN(x.getTime()) ? Utilities.formatDate(x, tz, 'h:mm a') : ''; };
  const ms = d => { const x = asDate(d); return x ? x.getTime() : 0; };
  const dowOf = key => Number(Utilities.formatDate(new Date(key + 'T12:00:00+05:30'), tz, 'u'));
  const ok = r => ['OK', 'Approved'].indexOf(String(r.status)) > -1;
  const mine = (o.att || []).filter(r => r.att_id && o.low(r.rep_email) === o.e);
  if (!mine.length) return '';
  const dayRows = key => mine.filter(r => o.dk(r.att_date) === key).sort((a, b) => ms(a.event_time) - ms(b.event_time));
  const map = g => String(g || '').trim() ? ' (<a href="https://maps.google.com/?q=' + encodeURIComponent(String(g).trim()) + '">map</a>)' : ' (no location)';
  const who = r => String(r.status) === 'Approved' ? 'approved by you' : String(r.status) === 'Rejected' ? 'rejected by you' : String(r.status) === 'Pending' ? 'NOT YET ANSWERED by you' : '';
  const why = r => String(r.reason || '').trim() ? ' Reason: ' + o.esc(r.reason) + '.' : '';
  const note = r => String(r.decision_note || '').trim() ? ' Your note: ' + o.esc(r.decision_note) + '.' : '';
  const workday = dowOf(o.today) <= 6;
  const rows = dayRows(o.today);
  const inR = rows.filter(r => String(r.kind) === 'IN').pop() || null;
  const outLive = rows.filter(r => String(r.kind) === 'OUT' && String(r.status) !== 'Rejected').pop() || null;
  rows.forEach(r => {
    const kind = String(r.kind) === 'IN' ? 'mark-in' : 'mark-out';
    const inLbl = {'Late': 'Late mark-in', 'Missed mark-out': 'Mark-in after a missed mark-out', 'Late, missed mark-out': 'Late mark-in after a missed mark-out'}[String(r.rule)];
    if (inLbl) o.red.push(inLbl + ' at ' + t(r.event_time) + ' – ' + who(r) + '.' + why(r) + note(r) + (String(r.status) === 'Rejected' ? ' Day marked absent.' : ''));
    if (String(r.rule) === 'Early') o.red.push('Asked to mark out early at ' + t(r.event_time) + ' – ' + who(r) + '.' + why(r) + note(r));
    const skew = Number(r.clock_skew_sec) || 0;
    if (Math.abs(skew) > 120) o.red.push('Phone clock was ' + Math.round(Math.abs(skew) / 60) + ' min ' + (skew > 0 ? 'slow' : 'fast') + ' at ' + kind + '. The time shown is corrected to the office clock.');
    if (!String(r.gps || '').trim()) o.red.push('No location at ' + kind + ' (' + t(r.event_time) + ').');
  });
  if (workday && !inR) o.red.push('No mark-in today – absent.');
  else if (inR && ok(inR) && !outLive) o.amber.push('Not marked out yet when this email was sent.');
  let prev = '';
  for (let k = 1; k < 8 && !prev; k++) {
    const key = Utilities.formatDate(new Date(new Date(o.today + 'T12:00:00+05:30').getTime() - k * 86400000), tz, 'yyyy-MM-dd');
    if (dowOf(key) <= 6) prev = key;
  }
  if (prev) {
    const pr = dayRows(prev);
    if (pr.some(r => String(r.kind) === 'IN' && ok(r)) && !pr.some(r => String(r.kind) === 'OUT' && ok(r))) o.red.push('No mark-out on ' + Utilities.formatDate(new Date(prev + 'T12:00:00+05:30'), tz, 'EEE d MMM') + '.');
  }
  if (!inR) return workday ? '<span style="color:#b00020"><b>No mark-in</b></span>' : 'Sunday – no mark-in needed';
  if (String(inR.status) === 'Rejected') return '<span style="color:#b00020"><b>Absent</b></span> – mark-in at ' + t(inR.event_time) + ' rejected by you';
  let line = 'In ' + t(inR.event_time) + map(inR.gps) + (/Late|Missed/.test(String(inR.rule)) ? ' – ' + String(inR.rule).toLowerCase() + ', ' + who(inR) : '');
  if (outLive) {
    const mins = Math.max(0, Math.round((ms(outLive.event_time) - ms(inR.event_time)) / 60000));
    line += ' · Out ' + t(outLive.event_time) + map(outLive.gps) + (String(outLive.rule) === 'Early' ? ' – early, ' + who(outLive) : '') + ' · ' + Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
  } else line += ' · not marked out yet';
  return line;
}
