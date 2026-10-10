function ordersPlacementFlags_(o) {
  const pn = {};
  (o.prods || []).forEach(p => { if (p.sku) pn[String(p.sku).toUpperCase().trim()] = String(p.name || p.sku).trim(); });
  const parse = v => { const r = {}; String(v || '').split(',').forEach(x => { const m = x.trim().match(/^([A-Z0-9]+)\s*:\s*(\d+)$/i); if (m && Number(m[2]) > 0) r[m[1].toUpperCase()] = (r[m[1].toUpperCase()] || 0) + Number(m[2]); }); return r; };
  const txt = ord => Object.keys(ord).map(s => (pn[s] || s) + ' ' + ord[s]).join(', ');
  const day = v => Utilities.formatDate(new Date(v), 'Asia/Kolkata', 'd MMM');
  const byId = {};
  o.visits.forEach(v => { byId[String(v.visit_id)] = v; });
  const mine = o.visits.filter(v => o.low(v.rep_email) === o.e);
  const shop = v => o.esc(o.name[v.shop_id] || v.shop_id);
  mine.filter(v => o.dk(v.visit_time) === o.today).forEach(v => {
    const res = String(v.order_result || '');
    if (String(v.order_ref || '').trim() && res && res !== 'Delivered in full') {
      const was = parse(v.order_was);
      const ref = byId[String(v.order_ref)];
      const got = {};
      Object.keys(was).forEach(s => { const q = Number(v['refill_' + s]) || 0; if (q > 0) got[s] = q; });
      const why = String(v.order_reason || '').trim() || 'none given';
      const msg = 'Order not delivered in full at ' + shop(v) + ': ordered ' + o.esc(txt(was)) + (ref ? ' on ' + day(ref.visit_time) : '') + ', delivered ' + (Object.keys(got).length ? o.esc(txt(got)) : 'nothing') + '. Reason: ' + o.esc(why) + '.';
      (/^Shop (cancelled|reduced)/.test(why) ? o.amber : o.red).push(msg);
    }
    if (String(v.place_ref || '').trim()) {
      const bad = [];
      if (String(v.place_eye_level) === 'No') bad.push('not at eye or hand level');
      if (String(v.place_one_block) === 'No') bad.push('not in one block');
      if (String(v.place_strip) === 'No') bad.push('shelf strip not in place');
      if (!String(v.place_eye_level || '')) bad.push('placement not answered');
      if (bad.length) {
        const why = String(v.place_reason || '').trim() || 'none given';
        (/^Owner refused/.test(why) ? o.amber : o.red).push('Shelf placement not right at ' + shop(v) + ': ' + bad.join(', ') + '. Reason: ' + o.esc(why) + '. Check the shelf photo of visit ' + o.esc(v.visit_id) + '.');
      }
    }
  });
  const latest = {};
  o.visits.forEach(v => { const t = new Date(v.visit_time).getTime() || 0; if (!latest[v.shop_id] || t > latest[v.shop_id].t) latest[v.shop_id] = {t: t, v: v}; });
  Object.keys(latest).forEach(s => {
    const v = latest[s].v;
    if (o.low(v.rep_email) !== o.e) return;
    const ord = parse(v.order_lines);
    if (!Object.keys(ord).length) return;
    const days = Math.round((new Date(o.today + 'T00:00:00').getTime() - new Date(o.dk(v.visit_time) + 'T00:00:00').getTime()) / 86400000);
    if (days === 0) o.amber.push('Order taken today at ' + shop(v) + ' for the next visit: ' + o.esc(txt(ord)) + '. Make sure he has the stock.');
    else if (days >= 3) o.amber.push('Order waiting ' + days + ' days at ' + shop(v) + ': ' + o.esc(txt(ord)) + ' (taken ' + day(v.visit_time) + '). It must be delivered at the next visit.');
  });
}
