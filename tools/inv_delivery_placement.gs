function deliveryPlacementFlags_(o) {
  const pn = {};
  (o.prods || []).forEach(p => { if (p.sku) pn[String(p.sku).toUpperCase().trim()] = String(p.name || p.sku).trim(); });
  const parse = v => { const r = {}; String(v || '').split(',').forEach(x => { const m = x.trim().match(/^([A-Z0-9]+)\s*:\s*(\d+)$/i); if (m && Number(m[2]) > 0) r[m[1].toUpperCase()] = (r[m[1].toUpperCase()] || 0) + Number(m[2]); }); return r; };
  const txt = ord => Object.keys(ord).map(s => (pn[s] || s) + ' ' + ord[s]).join(', ') || 'nothing';
  const day = v => Utilities.formatDate(new Date(v), 'Asia/Kolkata', 'd MMM');
  const byId = {};
  o.visits.forEach(v => { byId[String(v.visit_id)] = v; });
  const shop = v => o.esc(o.name[v.shop_id] || v.shop_id);
  const nextVisit = [];
  o.visits.filter(v => o.low(v.rep_email) === o.e && o.dk(v.visit_time) === o.today).forEach(v => {
    const res = String(v.deliver_result || '');
    if (res === 'Part delivered' || res === 'Not delivered') {
      const ref = byId[String(v.deliver_ref)];
      const was = parse(v.deliver_was), got = parse(v.deliver_lines), left = {};
      Object.keys(was).forEach(s => { const r = was[s] - (got[s] || 0); if (r > 0) left[s] = r; });
      const why = String(v.deliver_reason || '').trim() || 'none given';
      const when = ref ? ' on ' + day(ref.visit_time) : '';
      if (/^Shop (cancelled|reduced)/.test(why)) o.red.push(shop(v) + ' did not take packs already invoiced' + when + ': ' + o.esc(txt(left)) + ' (' + o.esc(why) + '). Raise a credit note for them.');
      else o.red.push('Invoiced packs not handed over at ' + shop(v) + ': owed ' + o.esc(txt(was)) + when + ', handed over ' + o.esc(txt(got)) + '. Still owed: ' + o.esc(txt(left)) + '. Reason: ' + o.esc(why) + '.');
    }
    const placed = String(v.delivery || '') === 'Handed over' || Object.keys(parse(v.deliver_lines)).length > 0;
    if (placed) {
      const bad = [];
      if (!String(v.place_eye_level || '')) bad.push('placement questions not answered');
      if (String(v.place_eye_level) === 'No') bad.push('not at eye or hand level');
      if (String(v.place_one_block) === 'No') bad.push('not in one block');
      if (String(v.place_strip) === 'No') bad.push('shelf strip not in place');
      if (bad.length) {
        const why = String(v.place_reason || '').trim() || 'none given';
        (/^Owner refused/.test(why) ? o.amber : o.red).push('Shelf placement not right at ' + shop(v) + ': ' + bad.join(', ') + '. Reason: ' + o.esc(why) + '. Check the shelf photo of visit ' + o.esc(v.visit_id) + '.');
      }
    }
    if (String(v.delivery || '') === 'Next visit') {
      const q = {};
      Object.keys(v).forEach(k => { const m = k.match(/^refill_(.+)$/); if (m && m[1] !== 'override' && Number(v[k]) > 0) q[m[1]] = Number(v[k]); });
      nextVisit.push(shop(v) + ' (' + o.esc(txt(q)) + ')');
    }
  });
  if (nextVisit.length) o.amber.push('Invoiced today, to be handed over at the next visit - make sure he has the stock: ' + nextVisit.join('; ') + '.');
  const latest = {};
  o.visits.forEach(v => { const t = new Date(v.visit_time).getTime() || 0; if (!latest[v.shop_id] || t > latest[v.shop_id].t) latest[v.shop_id] = {t: t, v: v}; });
  Object.keys(latest).forEach(s => {
    const v = latest[s].v;
    if (o.low(v.rep_email) !== o.e) return;
    const owe = parse(v.deliver_pending);
    if (!Object.keys(owe).length) return;
    const days = Math.round((new Date(o.today + 'T00:00:00').getTime() - new Date(o.dk(v.visit_time) + 'T00:00:00').getTime()) / 86400000);
    if (days >= 3) o.amber.push('Invoiced packs still not handed over at ' + shop(v) + ' after ' + days + ' days: ' + o.esc(txt(owe)) + ' (since ' + day(v.visit_time) + ').');
  });
}
