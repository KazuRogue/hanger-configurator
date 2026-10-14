import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

const FIELDS = [['door','Door thickness'],['projection','Hook projection'],['spacing','Hook spacing']];
const state = {}; let cfg, mesh, edges, framed = false, timer, ctl;
const $ = id => document.getElementById(id);

// Backend base URL (option-1 patch by Muse): ?backend= query param wins, then the
// saved value, else same-origin (local dev where the Python server serves web/).
const _bq = new URLSearchParams(location.search);
let BACKEND = _bq.get('backend') || '';
try { if (!BACKEND) BACKEND = localStorage.getItem('hanger_backend') || ''; } catch (e) {}
if (_bq.get('backend')) { try { localStorage.setItem('hanger_backend', BACKEND); } catch (e) {} }
const api = pth => BACKEND.replace(/\/+$/, '') + pth;
document.querySelector('header p').textContent += BACKEND ? ' · backend: ' + BACKEND : ' · backend: same-origin';

// --- three.js scene (Z up, matches print orientation) ---
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio); view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000); camera.up.set(0, 0, 1);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(150, -200, 300); scene.add(sun);
const grid = new THREE.GridHelper(300, 30, 0x99a, 0xccd); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = .35; scene.add(grid);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

function showMesh(pos, faded) {
  if (!pos) { if (mesh) mesh.material.opacity = .25; return; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); g.computeBoundingBox();
  const c = new THREE.Vector3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, 0);
  if (mesh) { scene.remove(mesh, edges); mesh.geometry.dispose(); }
  mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a78d6, roughness: .55, metalness: .05, transparent: true, opacity: 1 }));
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0x1d3a78, transparent: true, opacity: .45 }));
  scene.add(mesh, edges);
  if (!framed) { const s = g.boundingBox.getSize(new THREE.Vector3()); const r = Math.max(s.x, s.y, s.z);
    camera.position.set(r * 1.6, -r * 2.2, r * 1.3); controls.target.set(0, 0, s.z / 2); framed = true; }
}

// --- UI ---
function build() {
  const box = $('controls'); let h = '<div style="font-size:13px;color:var(--mute)">Hooks</div><div class="seg" id="hooks">' +
    [1,2,3].map(n => `<button data-n="${n}">${n}</button>`).join('') + '</div>';
  for (const [k, label] of FIELDS) { const [lo, hi] = cfg.limits[k];
    h += `<label><span>${label}</span><span>${lo}–${hi} mm</span></label><div class="row"><input type="range" id="r_${k}" min="${lo}" max="${hi}" step="0.5"><input type="number" id="n_${k}" min="${lo}" max="${hi}" step="0.5"></div>`; }
  box.innerHTML = h;
  for (const [k] of FIELDS) {
    for (const t of ['r', 'n']) $(`${t}_${k}`).addEventListener('input', e => { state[k] = e.target.value; sync(); schedule(); });
  }
  document.querySelectorAll('#hooks button').forEach(b => b.onclick = () => { state.hooks = +b.dataset.n; sync(); schedule(); });
  sync();
}
function sync() {
  for (const [k] of FIELDS) { $(`r_${k}`).value = state[k]; if (document.activeElement !== $(`n_${k}`)) $(`n_${k}`).value = state[k]; }
  for (const k of ['r_spacing', 'n_spacing']) $(k).disabled = state.hooks == 1;
  document.querySelectorAll('#hooks button').forEach(b => b.classList.toggle('on', +b.dataset.n == state.hooks));
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 200); };
let inflight;
async function refresh() {
  inflight?.abort(); inflight = new AbortController(); $('status').textContent = 'Generating…';
  try {
    const r = await fetch(api('/api/preview?') + new URLSearchParams(state), { signal: inflight.signal }); const j = await r.json();
    $('msgs').innerHTML = j.errors.map(e => `<div class="msg err">✕ ${e}</div>`).join('') + j.warnings.map(w => `<div class="msg warn">⚠ ${w}</div>`).join('');
    const d = j.dims, env = cfg.envelope;
    $('dims').innerHTML = d ? `<dt>Depth (X)</dt><dd>${d.x} mm</dd><dt>Width (Y)</dt><dd>${d.y} mm</dd><dt>Height (Z)</dt><dd>${d.z} mm</dd><dt>Door slot</dt><dd>${d.slot} mm</dd><dt>Envelope</dt><dd>${Math.max(d.x, d.y, d.z) <= env ? '✓ fits' : '✕ exceeds'} ${env} mm</dd>` : '<dt>Dimensions</dt><dd>—</dd>';
    if (j.ok) { showMesh(j.positions); $('status').textContent = ''; } else { showMesh(null); $('status').textContent = 'Invalid configuration'; }
  } catch (e) { if (e.name !== 'AbortError') $('status').textContent = 'Server error'; }
}

cfg = await (await fetch(api('/api/config'))).json(); Object.assign(state, cfg.defaults); build(); refresh();
if (cfg.production_enabled) { $('dev').style.display = '';
  $('prod').onclick = async () => { $('prodout').textContent = 'Generating…';
    const r = await fetch(api('/api/production'), { method: 'POST', body: JSON.stringify(state) }); const j = await r.json();
    $('prodout').innerHTML = j.ok ? `Saved privately: <code>${j.private_file.file}</code> · ${j.private_file.size_mm.join(' × ')} mm · ${j.private_file.triangles} tris · watertight ${j.private_file.watertight} · sha ${j.private_file.sha256}` : `<span class="err">${j.errors.join('; ')}</span>`; }; }
