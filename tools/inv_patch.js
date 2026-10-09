window.__invPatch = function (apply) {
  const ms = monaco.editor.getModels();
  const code = ms.find(m => /function dailySummary\(\)/.test(m.getValue()));
  const page = ms.find(m => /const SKUS = \['DAL','IDLI','CURRY','MORINGA','GARLIC','RASAM','KING','QUEEN','VATHAL','MOR','WSAMBAR','AVIAL'\];/.test(m.getValue()));
  const res = [];
  if (!code) return 'Code.gs not found';
  let c = code.getValue();
  const r1a = "ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();";
  const r1b = "ScriptApp.newTrigger('weeklyBackup').timeBased().everyDays(1).atHour(3).create();";
  const r2a = "mine.slice(8).forEach(f => { f.setTrashed(true);";
  const r2b = "mine.slice(14).forEach(f => { f.setTrashed(true);";
  const r3a = "(dupPhotos[e] || []).forEach(t => red.push('Photo reused: ' + esc(t) + '.'));";
  const r3b = "(function () {\n" +
    "      const sl = T('APP_SyncLog').filter(x => low(x.rep_email) === e && dk(x.received_at) === today);\n" +
    "      if (!sl.length) return;\n" +
    "      const late = sl.filter(x => num(x.delay_sec) > 120);\n" +
    "      const weak = sl.filter(x => num(x.gps_accuracy_m) > 100);\n" +
    "      if (late.length) amber.push(late.length + ' of ' + sl.length + ' app visit(s) reached the office more than 2 minutes after saving (longest ' + Math.max(1, Math.round(Math.max.apply(null, late.map(x => num(x.delay_sec))) / 60)) + ' min). Usually no signal; check the phone if it repeats.');\n" +
    "      else amber.push('All ' + sl.length + ' app visit(s) reached the office within 2 minutes of saving.');\n" +
    "      if (weak.length) amber.push(weak.length + ' app visit(s) had a weak GPS fix (worse than 100 m): ' + weak.map(x => esc(name[x.shop_id] || x.shop_id)).join(', ') + '.');\n" +
    "    })();\n    " + r3a;
  [[r1a, r1b], [r2a, r2b], [r3a, r3b]].forEach(([a, b], i) => {
    const n = c.split(a).length - 1;
    res.push('code' + (i + 1) + ':' + n);
    if (n === 1) c = c.replace(a, b);
  });
  try { new Function(c); res.push('code syntax ok'); } catch (e) { res.push('code syntax ERROR ' + e.message); return res.join(' | '); }
  let p = page ? page.getValue() : null;
  if (p) {
    p = p.replace("const SKUS = ['DAL','IDLI','CURRY','MORINGA','GARLIC','RASAM','KING','QUEEN','VATHAL','MOR','WSAMBAR','AVIAL'];", "const SKUS = ['DAL','IDLI','CURRY','MORINGA','GARLIC','RASAM','KING','QUEEN','VATHAL','MOR','WSAMBAR','AVIAL','IDLI15','DAL15','CURRY15','MORINGA15','PULI15','VATHAL15','MOR15'];");
    res.push('page SKUS patched');
  } else res.push('page SKUS line not found (maybe already patched)');
  if (apply && res.every(x => !/:0|:2|ERROR/.test(x))) {
    code.setValue(c);
    if (p) page.setValue(p);
    res.push('APPLIED - now save');
  }
  return res.join(' | ');
};
'patch loaded';
