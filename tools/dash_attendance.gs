function attDecideDash(id, decision, note, test) {
  dcOwner_();
  if (['Approved', 'Rejected'].indexOf(decision) < 0) throw new Error('Choose Approve or Reject.');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = SpreadsheetApp.openById(CFG.FIELD_ID).getSheetByName((test ? 'TEST_' : '') + 'APP_Attendance');
    if (!sh) throw new Error('No attendance recorded yet.');
    const v = sh.getDataRange().getValues();
    const head = v[0].map(x => String(x).trim());
    const ic = head.indexOf('att_id'), sc = head.indexOf('status');
    const r = v.findIndex((row, k) => k > 0 && String(row[ic]) === String(id));
    if (r < 1) throw new Error('Request not found.');
    if (['Pending', 'Approved', 'Rejected'].indexOf(String(v[r][sc])) < 0) throw new Error('This entry was within the rules – nothing to approve.');
    const now = new Date();
    const set = {status: decision, decided_at: now, decided_by: 'Ashwin (dashboard)', decision_note: String(note || '').trim().slice(0, 300)};
    Object.keys(set).forEach(k => { const c = head.indexOf(k); if (c > -1) sh.getRange(r + 1, c + 1).setValue(set[k]); });
    return JSON.stringify({status: decision, decided_at: now.toISOString(), decision_note: set.decision_note});
  } finally {
    lock.releaseLock();
  }
}
