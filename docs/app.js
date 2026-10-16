import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as L from './logic.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- backend selection: ?backend= overrides, then saved value, then same origin ----------
const BKEY = 'hanger.backend';
const OLDKEY = 'hanger_backend';   // v1 key, read-only fallback
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
function resolveBackend() {
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) { const v = q.trim().replace(/\/+$/, ''); if (v) store.set(BKEY, v); else store.del(BKEY); return v; }   // ?backend= (empty) clears
  return store.get(BKEY) || store.get(OLDKEY) || '';
}
const BACKEND = resolveBackend();
const api = (path, opts) => fetch(BACKEND + path, opts);
$('backend').textContent = BACKEND ? `Backend: ${BACKEND}` : 'Backend: this site';

// ---------- units: mm | in (internal state is always mm) ----------
const U = {
  unit: (() => { try { return localStorage.getItem('hanger.unit') || 'mm'; } catch { return 'mm'; } })(),
  fmt(mm) { const v = +mm; return this.unit === 'in' ? (v / 25.4).toFixed(2) + ' in' : v.toFixed(1).replace(/\.0$/, '') + ' mm'; },
  fmtNum(mm) { const v = +mm; return this.unit === 'in' ? (v / 25.4).toFixed(2) : String(v); },
  toMM(v) { const n = parseFloat(v); return this.unit === 'in' && Number.isFinite(n) ? n * 25.4 : n; },
  set(u) { this.unit = u; try { localStorage.setItem('hanger.unit', u); } catch {} },
};
function syncUnitButtons() {
  $('unit-mm').setAttribute('aria-pressed', String(U.unit === 'mm'));
  $('unit-in').setAttribute('aria-pressed', String(U.unit === 'in'));
}
$('unit-mm').onclick = () => { U.set('mm'); syncUnitButtons(); buildCabinet(); buildOverDoor(); selectTab(S.tab); };
$('unit-in').onclick = () => { U.set('in'); syncUnitButtons(); buildCabinet(); buildOverDoor(); selectTab(S.tab); };
syncUnitButtons();

// ---------- 3D view (Z up). Mesh JSON only; never a production file ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 6000); camera.up.set(0, 0, 1);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(150, -200, 300); scene.add(sun);
const grid = new THREE.GridHelper(1200, 60, 0x99a, 0xccd); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = .3; scene.add(grid);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

let mesh = null, edges = null, reframe = true;
function clearMesh() { if (mesh) { scene.remove(mesh, edges); mesh.geometry.dispose(); mesh = edges = null; } }
function showMesh(pos, { flipToUse = false } = {}) {
  const p = Float32Array.from(pos);
  if (flipToUse) for (let i = 0; i < p.length; i += 3) { p[i + 1] = -p[i + 1]; p[i + 2] = -p[i + 2]; }   // as-printed -> as-used (rotate 180° about X)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.computeVertexNormals(); g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
  g.translate(-c.x, -c.y, -g.boundingBox.min.z); g.computeBoundingBox();
  clearMesh();
  mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a78d6, roughness: .55, metalness: .05 }));
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0x1d3a78, transparent: true, opacity: .45 }));
  scene.add(mesh, edges);
  if (reframe) {
    const r = Math.max(s.x, s.y, s.z), tall = s.z > 2 * Math.max(s.x, s.y);
    camera.position.set(r * (tall ? 1.1 : 1.6), -r * (tall ? 1.6 : 2.2), r * (tall ? 0.65 : 1.3)); controls.target.set(0, 0, s.z / 2); reframe = false;
  }
}
const fadeMesh = (on) => { if (mesh) { mesh.material.transparent = true; mesh.material.opacity = on ? .25 : 1; } };

// ---------- preview loading (debounced by callers, abortable, stale-safe) ----------
let inflight = null, seq = 0;
async function loadPreview(path, opts = {}) {
  inflight?.abort(); inflight = new AbortController(); const mine = ++seq;
  $('status').textContent = 'Generating…';
  try {
    const r = await api(path, { signal: inflight.signal }); const j = await r.json(); if (mine !== seq) return;
    renderMessages(j); renderDims(j.dims);
    const chk = L.checkPreview(j);
    if (chk.ok) { showMesh(j.positions, opts); fadeMesh(false); $('status').textContent = ''; }
    else { fadeMesh(true); $('status').textContent = 'Preview unavailable'; if (!(j.errors || []).length) addMsg('err', chk.problem); }
  } catch (e) { if (e.name !== 'AbortError') { fadeMesh(true); $('status').textContent = 'Could not reach the server'; addMsg('err', `Could not reach the backend (${BACKEND || 'this site'}).`); } }
}
const timers = {};
const debounced = (key, fn, ms = 200) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };
function renderMessages(j) { $('msgs').innerHTML = (j.errors || []).map((e) => `<div class="msg err">✕ ${esc(e)}</div>`).join('') + (j.warnings || []).map((w) => `<div class="msg warn">⚠ ${esc(w)}</div>`).join(''); }
const addMsg = (cls, t) => { $('msgs').insertAdjacentHTML('beforeend', `<div class="msg ${cls}">${cls === 'err' ? '✕' : '⚠'} ${esc(t)}</div>`); };
function renderDims(d) {
  $('dims').innerHTML = d ? ['x', 'y', 'z'].filter((k) => d[k] != null).map((k, i) => `<dt>${['Depth', 'Width', 'Height'][i]}</dt><dd>${U.fmt(d[k])}</dd>`).join('') + (d.slot != null ? `<dt>Door slot</dt><dd>${U.fmt(d.slot)}</dd>` : '') : '';
}
const setOrder = (text, cta) => { $('order').textContent = text || ''; const b = $('cta'); b.disabled = !cta; b.textContent = cta || 'Choose a size'; };
$('cta').onclick = () => { $('cta-note').textContent = `Checkout isn't connected yet (needs the Teleport/Etsy integration). You chose: ${$('order').textContent}.`; };

// ---------- state ----------
let cat = null; const S = { tab: 'cabinet', cab: {}, od: { door: null, mode: 'onepiece', rails: 2, pegs: [] } };

// ---------- Cabinet tab ----------
const CAB_FIELDS = [['door', 'Your door thickness'], ['projection', 'Hook projection'], ['spacing', 'Hook spacing']];
function buildCabinet() {
  const lim = cat.cabinet.limits; if (!lim) { $('cab-controls').innerHTML = '<p class="small">Controls unavailable.</p>'; return; }
  Object.assign(S.cab, cat.cabinet.defaults);
  let h = '<div style="font-size:14px;color:var(--mute)">Hooks</div><div class="seg" id="cab-hooks">' +
    Array.from({ length: lim.hooks[1] - lim.hooks[0] + 1 }, (_, i) => `<button data-n="${lim.hooks[0] + i}">${lim.hooks[0] + i}</button>`).join('') + '</div>';
  for (const [k, label] of CAB_FIELDS) { const [lo, hi] = lim[k];
    h += `<label for="cn_${k}"><span>${label}</span><span>${U.fmt(lo)}–${U.fmt(hi)}</span></label><div class="row"><input type="range" id="cr_${k}" min="${lo}" max="${hi}" step="0.1" aria-label="${label} slider"><input type="number" id="cn_${k}" min="${U.fmtNum(lo)}" max="${U.fmtNum(hi)}" step="${U.unit === 'in' ? '0.05' : '0.1'}" inputmode="decimal"></div>`; }
  $('cab-controls').innerHTML = h;
  for (const [k] of CAB_FIELDS) for (const t of ['cr', 'cn']) $(`${t}_${k}`).addEventListener('input', (e) => { S.cab[k] = t === 'cn' ? U.toMM(e.target.value) : +e.target.value; syncCabinet(); onCabinetChange(); });
  document.querySelectorAll('#cab-hooks button').forEach((b) => b.onclick = () => { S.cab.hooks = +b.dataset.n; syncCabinet(); onCabinetChange(); });
  syncCabinet();
}
function syncCabinet() {
  // Envelope guard: cap hook spacing so the width never exceeds the print envelope.
  const smax = cat.cabinet.parametric && cat.cabinet.parametric.spacing_max_by_hooks;
  const hooks = +S.cab.hooks;
  if (smax && hooks > 1 && smax[String(hooks)] != null) {
    const cap = +smax[String(hooks)];
    if (+S.cab.spacing > cap) S.cab.spacing = cap;
    for (const t of ['cr', 'cn']) $(`${t}_spacing`).max = cap;
  }
  for (const [k] of CAB_FIELDS) { $(`cr_${k}`).value = S.cab[k]; if (document.activeElement !== $(`cn_${k}`)) $(`cn_${k}`).value = U.fmtNum(S.cab[k]); }
  for (const k of ['cr_spacing', 'cn_spacing']) $(k).disabled = +S.cab.hooks === 1;
  document.querySelectorAll('#cab-hooks button').forEach((b) => b.classList.toggle('on', +b.dataset.n === +S.cab.hooks));
}
function renderCabinetMatch() {
  const t = parseFloat(S.cab.door), v = L.matchVariant(cat.cabinet.variants, t), box = $('cab-match');
  box.classList.toggle('no', !v);
  if (v) {
    const p = v.params;
    box.innerHTML = `<b>${esc(v.id)}</b> fits your ${U.fmt(t)} door<div class="small">Fits doors ${U.fmt(v.window[0])}–${U.fmt(v.window[1])}. ${esc(v.covers)}</div>` +
      `<div class="small">As sold: ${p.hooks} hooks, ${U.fmt(p.projection)} projection${+p.hooks > 1 ? `, ${U.fmt(p.spacing)} spacing` : ''}.</div><button class="alt" id="cab-exact">Preview ${esc(v.id)} exactly as sold</button>`;
    $('cab-exact').onclick = () => { Object.assign(S.cab, { door: v.params.door, projection: v.params.projection, hooks: v.params.hooks, spacing: v.params.spacing }); syncCabinet(); onCabinetChange(); };
    setOrder(`1× ${v.id}`, `Get ${v.id}`);
  } else {
    box.innerHTML = `<b>No variant fits</b><div class="small">${esc(L.noFitMessage(cat.cabinet.variants, t))}</div>`; setOrder('', null);
  }
}
function onCabinetChange() { renderCabinetMatch(); debounced('prev', () => loadPreview(L.cabinetPath(S.cab))); }

// ---------- Over-door tab ----------
function odRange() {
  const w = cat.overDoor.variants.map((v) => v.window).flat(), lo = Math.min(...w), hi = Math.max(...w);
  return cat.overDoor.doorRange || [Math.floor(lo - 5), Math.ceil(hi + 5)];
}
function buildOverDoor() {
  const od = cat.overDoor; if (!od) { $('panel-od').innerHTML = '<div class="card"><b>Over-door catalog unavailable</b><p class="small">This backend did not return over-door products. Try another backend.</p></div>'; return; }
  const [lo, hi] = odRange(); S.od.door = od.defaultDoor ?? Math.round((od.variants[0].window[0] + od.variants[0].window[1]) / 2);
  for (const id of ['od-door-r', 'od-door']) { $(id).min = lo; $(id).max = hi; $(id).value = id === 'od-door' ? U.fmtNum(S.od.door) : S.od.door; }
  $('od-door-r').step = '0.1';
  if ($('od-door')) { $('od-door').min = U.fmtNum(lo); $('od-door').max = U.fmtNum(hi); $('od-door').step = U.unit === 'in' ? '0.05' : '0.1'; }
  for (const id of ['od-door-r', 'od-door']) $(id).addEventListener('input', (e) => { S.od.door = id === 'od-door' ? U.toMM(e.target.value) : +e.target.value; if (id === 'od-door') $('od-door-r').value = S.od.door; else if (document.activeElement !== $('od-door')) $('od-door').value = U.fmtNum(S.od.door); reframe = true; onOverDoorChange(); });
  document.querySelectorAll('#od-mode button').forEach((b) => b.onclick = () => { S.od.mode = b.dataset.mode; reframe = true; onOverDoorChange(); });
  if (od.kit) {
    const k = od.kit, n = []; for (let i = k.rail.minCount; i <= k.rail.maxCount; i++) n.push(i);
    $('kit-rails').innerHTML = n.map((i) => `<button data-n="${i}">${i}</button>`).join('');
    document.querySelectorAll('#kit-rails button').forEach((b) => b.onclick = () => setRails(+b.dataset.n));
    S.od.rails = Math.min(2, k.rail.maxCount); S.od.pegs = L.defaultPegs(L.availableRungs(k.rungs, S.od.rails), k.peg.max);
  }
}
function setRails(n) {
  const k = cat.overDoor.kit, was = S.od.pegs; S.od.rails = n;
  const r = L.prunePegs(was, k.rungs, n, k.peg.max); S.od.pegs = r.pegs; reframe = true; onOverDoorChange();
  if (r.removed.length) $('kit-peg-note').textContent = `Removed the peg at ${r.removed.join(', ')} mm: it needs more rails.`;
}
function renderRungs() {
  const k = cat.overDoor.kit, avail = L.availableRungs(k.rungs, S.od.rails), ok = new Set(avail.map((r) => r.mm));
  const groups = new Map(); for (const r of k.rungs) { if (!groups.has(r.rail)) groups.set(r.rail, []); groups.get(r.rail).push(r); }
  $('kit-rungs').innerHTML = [...groups].map(([rail, rs]) => `<div class="small" style="margin-top:8px">${rail === 0 ? 'On the saddle' : 'Rail ' + rail}</div><div class="chips">` +
    rs.map((r) => `<button data-mm="${r.mm}" class="${S.od.pegs.includes(r.mm) ? 'on' : ''}" ${ok.has(r.mm) ? '' : 'disabled'} aria-pressed="${S.od.pegs.includes(r.mm)}">${U.fmtNum(r.mm)}</button>`).join('') + '</div>').join('');
  $('kit-rungs').querySelectorAll('button').forEach((b) => b.onclick = () => {
    const res = L.togglePeg(S.od.pegs, +b.dataset.mm, avail, k.peg.max);
    $('kit-peg-note').textContent = res.error || 'Pegs are optional. Tap a position to add or remove a peg.';
    S.od.pegs = res.pegs; onOverDoorChange();
  });
  const reach = L.reachRange(avail); $('kit-reach').textContent = reach ? `With ${S.od.rails} rail${S.od.rails > 1 ? 's' : ''}, pegs can sit from ${U.fmt(reach[0])} to ${U.fmt(reach[1])} below the door top.` : '';
  document.querySelectorAll('#kit-rails button').forEach((b) => b.classList.toggle('on', +b.dataset.n === S.od.rails));
}
function onOverDoorChange() {
  const od = cat.overDoor; if (!od) return;
  const t = parseFloat(S.od.door), v = L.matchVariant(od.variants, t), box = $('od-match'), modeCard = $('od-mode-card');
  box.classList.toggle('no', !v); modeCard.hidden = !v;
  if (!v) {
    box.innerHTML = `<b>No variant fits</b><div class="small">${esc(L.noFitMessage(od.variants, t))}</div>`; setOrder('', null);
    $('msgs').innerHTML = ''; $('dims').innerHTML = ''; fadeMesh(true); $('status').textContent = ''; inflight?.abort(); return;
  }
  const kitOk = !!(od.kit && L.matchSaddle(od.kit.saddles, t));
  if (!kitOk && S.od.mode === 'kit') S.od.mode = 'onepiece';
  document.querySelectorAll('#od-mode button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === S.od.mode); if (b.dataset.mode === 'kit') b.disabled = !kitOk; });
  $('od-mode-note').textContent = S.od.mode === 'kit' ? 'Small parts that snap together with no tools; hooks can sit far down the door.' : 'One printed piece with hooks at the very top of the door.';
  $('kit-builder').hidden = S.od.mode !== 'kit';
  box.innerHTML = `<b>${esc(v.id)}</b> fits your ${U.fmt(t)} door<div class="small">Fits doors ${U.fmt(v.window[0])}–${U.fmt(v.window[1])}. ${esc(v.covers)}</div>`;
  if (S.od.mode === 'kit') {
    const k = od.kit, sad = L.matchSaddle(k.saddles, t); renderRungs();
    const bom = L.kitBom({ saddleId: sad.id, railId: k.rail.id, pegId: k.peg.id, rails: S.od.rails, pegs: S.od.pegs });
    setOrder(bom.text, 'Get this kit');
    debounced('prev', () => loadPreview(L.kitPath({ saddle: sad.id, rails: S.od.rails, pegs: S.od.pegs })));
  } else {
    setOrder(`1× ${v.id}`, `Get ${v.id}`);
    debounced('prev', () => loadPreview(L.overDoorPath(v.id), { flipToUse: v.orientation === 'as_printed' }));
  }
}

// ---------- tabs ----------
function selectTab(tab) {
  S.tab = tab; reframe = true; inflight?.abort();
  for (const [id, name] of [['tab-cabinet', 'cabinet'], ['tab-od', 'od']]) $(id).setAttribute('aria-selected', String(name === tab));
  $('panel-cabinet').hidden = tab !== 'cabinet'; $('panel-od').hidden = tab !== 'od';
  $('msgs').innerHTML = ''; $('dims').innerHTML = ''; $('cta-note').textContent = "Checkout isn't connected yet.";
  clearMesh(); tab === 'cabinet' ? onCabinetChange() : onOverDoorChange();
}
$('tab-cabinet').onclick = () => selectTab('cabinet'); $('tab-od').onclick = () => selectTab('od');

// ---------- boot: /api/catalog is the single source; /api/config only as a cabinet-only fallback ----------
async function boot() {
  try {
    const r = await api('/api/catalog'); if (!r.ok) throw new Error(`catalog HTTP ${r.status}`);
    cat = L.normalizeCatalog(await r.json());
  } catch (e) {
    try {   // older backend: cabinet-only, no variant matching possible
      const c = await (await api('/api/config')).json();
      cat = { envelope: c.envelope, cabinet: { limits: c.limits, defaults: c.defaults, variants: [] }, overDoor: null };
      addMsg('warn', 'This backend has no product catalog yet, so sizes cannot be matched. Showing the basic cabinet explorer only.');
    } catch { $('status').textContent = 'Could not reach the server'; addMsg('err', `Could not load the catalog from ${BACKEND || 'this site'}: ${e.message}`); return; }
  }
  buildCabinet(); buildOverDoor(); selectTab('cabinet');
}
boot();
