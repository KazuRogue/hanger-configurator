// Pure logic for the product selector. No DOM, no network, no three.js, so it can be unit-tested in Node.
// All dimensions/windows come from /api/catalog; nothing is hardcoded here.

const EPS = 1e-9;
const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`catalog: ${name} is not a number`); return n; };
const win = (v) => {
  const w = v.fit_window || v.window;
  if (!Array.isArray(w) || w.length !== 2) throw new Error(`catalog: variant ${v.id} has no fit_window [lo, hi]`);
  return [num(w[0], `${v.id}.fit_window[0]`), num(w[1], `${v.id}.fit_window[1]`)];
};
const variant = (v) => ({ id: String(v.id), label: v.label || String(v.id), params: v.params || {}, window: win(v), dims: v.dims || null,
                          covers: v.covers || '', orientation: v.preview_orientation || 'as_used' });

// Accepts the shape documented in docs/CATALOG_CONTRACT.md. Aliases are tolerated in this one place only.
export function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('catalog: not an object');
  const m = raw.models || {};
  const cab = m.cabinet; if (!cab || !Array.isArray(cab.variants) || !cab.variants.length) throw new Error('catalog: models.cabinet.variants missing');
  const out = { envelope: raw.envelope_mm || null,
    cabinet: { limits: (cab.parametric || {}).limits || cab.limits || null, defaults: (cab.parametric || {}).defaults || cab.defaults || {},
               variants: cab.variants.map(variant) },
    overDoor: null };
  const od = m.over_door;
  if (od && Array.isArray(od.variants) && od.variants.length) {
    const kit = od.kit || null;
    out.overDoor = { variants: od.variants.map(variant), doorRange: od.door_input_range || null, defaultDoor: od.default_door_mm ?? null, kit: null };
    if (kit) {
      const legMm = num(kit.saddle_leg_mm ?? 0, 'kit.saddle_leg_mm'), railLen = num((kit.rail || {}).length_mm ?? 0, 'kit.rail.length_mm');
      const rungs = (kit.rungs_mm || []).map((r) => {
        const mm = num(typeof r === 'object' ? r.mm : r, 'rung');
        const rail = typeof r === 'object' && r.rail != null ? r.rail : (mm <= legMm || !railLen ? 0 : Math.floor((mm - legMm) / railLen) + 1);
        return { mm, rail };
      }).sort((a, b) => a.mm - b.mm);
      out.overDoor.kit = {
        saddles: (kit.saddles || []).map((s) => ({ id: String(s.id), window: win(s), dims: s.dims || null })),
        rail: { id: String((kit.rail || {}).id), maxCount: (kit.rail || {}).max_count ?? 3, minCount: (kit.rail || {}).min_count ?? 1 },
        peg: { id: String((kit.peg || {}).id), max: (kit.peg || {}).max_per_kit ?? 3 },
        rungs };
    }
  }
  return out;
}

export function matchVariant(variants, t) {
  if (!Number.isFinite(t)) return null;
  return variants.find((v) => t >= v.window[0] - EPS && t <= v.window[1] + EPS) || null;
}
export function matchSaddle(saddles, t) {
  return saddles.find((s) => t >= s.window[0] - EPS && t <= s.window[1] + EPS) || null;
}
export function sortedWindows(variants) { return variants.map((v) => v.window).sort((a, b) => a[0] - b[0]); }
export function coverageText(variants) { return sortedWindows(variants).map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} mm`).join(' and '); }
export function gaps(variants) {
  const w = sortedWindows(variants), out = [];
  for (let i = 0; i + 1 < w.length; i++) if (w[i + 1][0] - w[i][1] > EPS) out.push([w[i][1], w[i + 1][0]]);
  return out;
}
// Honest explanation for a thickness no variant fits.
export function noFitMessage(variants, t) {
  if (!Number.isFinite(t)) return 'Enter your door thickness in mm.';
  const w = sortedWindows(variants), lo = w[0][0], hi = w[w.length - 1][1];
  const where = t < lo ? `thinner than our range` : t > hi ? `thicker than our range` : `in a gap between our sizes`;
  const gap = gaps(variants).find(([a, b]) => t > a && t < b);
  const gapTxt = gap ? ` The ${gap[0].toFixed(1)}–${gap[1].toFixed(1)} mm gap is real: no size fits it.` : '';
  return `No variant fits a ${t.toFixed(1)} mm door (${where}). We make ${coverageText(variants)}.${gapTxt} Re-measure at the top edge, or this product won't fit your door.`;
}

export function kitBom({ saddleId, railId, pegId, rails, pegs }) {
  const items = [{ id: saddleId, qty: 1 }, { id: railId, qty: rails }];
  if (pegs.length) items.push({ id: pegId, qty: pegs.length });
  return { items, text: items.map((i) => `${i.qty}× ${i.id}`).join(' + ') };
}
export const availableRungs = (rungs, rails) => rungs.filter((r) => r.rail <= rails);
export function reachRange(avail) { return avail.length ? [avail[0].mm, avail[avail.length - 1].mm] : null; }
export function prunePegs(pegs, rungs, rails, maxPegs) {
  const ok = new Set(availableRungs(rungs, rails).map((r) => r.mm)), kept = [], removed = [];
  for (const p of pegs) (ok.has(p) && kept.length < maxPegs ? kept : removed).push(p);
  return { pegs: kept.sort((a, b) => a - b), removed };
}
export function togglePeg(pegs, mm, avail, maxPegs) {
  if (!avail.some((r) => r.mm === mm)) return { pegs, error: 'That position needs more rails.' };
  if (pegs.includes(mm)) return { pegs: pegs.filter((p) => p !== mm), error: null };
  if (pegs.length >= maxPegs) return { pegs, error: `A kit takes at most ${maxPegs} pegs. Tap a selected position to remove it first.` };
  return { pegs: [...pegs, mm].sort((a, b) => a - b), error: null };
}
export function defaultPegs(avail, maxPegs) {   // visible default: top position + deepest available
  if (!avail.length) return [];
  const a = [avail[0].mm, avail[avail.length - 1].mm];
  return [...new Set(a)].slice(0, maxPegs);
}

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const cabinetPath = (p) => '/api/preview?' + qs({ model: 'cabinet', door: p.door, projection: p.projection, hooks: p.hooks, spacing: p.spacing });
export const overDoorPath = (variantId) => '/api/overdoor/preview?' + qs({ variant: variantId });
export const kitPath = ({ saddle, rails, pegs }) => '/api/kit/preview?' + `saddle=${encodeURIComponent(saddle)}&rails=${rails}&pegs=${pegs.join(',')}`;

// Every preview endpoint must return {ok, positions, dims, warnings, errors}. Be strict about what we draw.
export function checkPreview(j) {
  if (!j || typeof j !== 'object') return { ok: false, problem: 'empty response' };
  if (j.ok === false) return { ok: false, problem: (j.errors || ['preview failed']).join('; ') };
  if (!Array.isArray(j.positions) || j.positions.length < 9 || j.positions.length % 9) return { ok: false, problem: 'response has no usable mesh' };
  return { ok: true, problem: null };
}
