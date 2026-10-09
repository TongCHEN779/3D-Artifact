// ===== App: UI, pipeline orchestration, viewer, export =====
(function () {
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- params ----------
const fmt = {
  threshold: v => v, adaptC: v => v, speck: v => v + ' mm²', lineWidth: v => (+v).toFixed(2) + ' mm',
  smoothness: v => (+v).toFixed(2), minWidth: v => (+v).toFixed(2) + ' mm', brushSize: v => v + ' mm',
  width: v => v + ' mm', thick: v => v + ' mm', plateT: v => (+v).toFixed(1) + ' mm', reliefH: v => (+v).toFixed(1) + ' mm',
  baseD: v => v + ' mm', baseH: v => v + ' mm', overhang: v => v + ' mm', insert: v => v + ' mm', clearance: v => (+v).toFixed(2) + ' mm',
  textH: v => (+v).toFixed(1) + ' mm', textD: v => (+v).toFixed(1) + ' mm',
};
const stageOf = {
  width: 1, thMode: 2, threshold: 2, adaptC: 2, invert: 2, speck: 2,
  islands: 3, smooth: 3, lineWidth: 3, smoothness: 3, minWidth: 3, kind: 3, bar: 3,
  thick: 4, plateT: 4, reliefH: 4, base: 4, baseD: 4, baseH: 4, overhang: 4, insert: 4, clearance: 4, step: 4,
  text1: 4, text2: 4, font: 4, textH: 4, textD: 4,
};
const seg = {};
document.querySelectorAll('.seg').forEach(el => {
  const name = el.dataset.name;
  seg[name] = el.querySelector('[aria-pressed="true"]').dataset.v;
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    seg[name] = b.dataset.v; onChange(name);
  });
});
function setSeg(name, v) { const el = document.querySelector(`.seg[data-name="${name}"]`); el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v ? 'true' : 'false')); seg[name] = v; }
document.querySelectorAll('input[type=range]').forEach(inp => {
  const out = document.querySelector(`output[for="${inp.id}"]`);
  const show = () => { if (out) out.textContent = (fmt[inp.id] || (v => v))(inp.value); };
  show(); inp.addEventListener('input', () => { show(); onChange(inp.id); });
});
document.querySelectorAll('input[type=checkbox], select').forEach(inp => inp.addEventListener('change', () => onChange(inp.id)));
document.querySelectorAll('input[type=text]').forEach(inp => inp.addEventListener('input', () => onChange(inp.id)));

function P() {
  const n = id => +$(id).value;
  return {
    width: n('width'), thMode: seg.thMode, threshold: n('threshold'), adaptC: n('adaptC'), invert: $('invert').checked, speck: n('speck'),
    islands: seg.islands, smooth: $('smooth').checked, lineWidth: n('lineWidth'), smoothness: n('smoothness'), minWidth: n('minWidth'),
    kind: seg.kind, thick: n('thick'), bar: $('bar').checked, plateT: n('plateT'), reliefH: n('reliefH'),
    base: seg.base, baseD: n('baseD'), baseH: n('baseH'), overhang: n('overhang'), insert: n('insert'), clearance: n('clearance'), step: $('step').checked,
    text1: $('text1').value.trim(), text2: $('text2').value.trim(), font: $('font').value, textH: n('textH'), textD: n('textD'),
  };
}

function syncUI() {
  const p = P();
  $('rowTh').hidden = p.thMode === 'adaptive'; $('rowC').hidden = p.thMode !== 'adaptive';
  $('threshold').disabled = p.thMode === 'auto';
  $('rowLW').hidden = $('rowSm').hidden = !p.smooth;
  const br = seg.brush !== 'off';
  $('rowBrush').hidden = $('brushBtns').hidden = $('brushHint').hidden = !br;
  document.querySelectorAll('[data-for]').forEach(el => el.hidden = el.dataset.for !== p.kind);
  $('baseMore').hidden = p.base === 'none';
  $('rowClr').hidden = p.base !== 'separate';
  const standing = p.base !== 'none';
  $('rowT2').hidden = !standing;
  $('t1label').textContent = standing ? '底座正面' : '牌子底部';
  const textOff = !standing && p.kind === 'cutout';
  $('text1').disabled = textOff;
  $('textNote').textContent = textOff ? '平放的剪影没有地方刻字。选择底座，或改成浮雕牌（字会凸起在牌子底部）。'
    : standing ? '文字刻进底座的前后两个侧面，从各自那一面看都是正的。' : '文字会凸起在牌子底部的边框里。';
  if (typeof drawLegend === "function") drawLegend();
}

function onChange(id) {
  syncUI();
  if (id === 'brush') { if (seg.brush !== 'off') showTab('line'); drawLine(); return; }
  if (id === 'brushSize') return;
  if (id === 'thMode' && seg.thMode === 'manual' && cache.autoTh) $('threshold').value = cache.autoTh;
  invalidate(stageOf[id] || 4);
}

// ---------- tabs ----------
let tab = '3d';
function showTab(t) {
  tab = t;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  $('srcCanvas').hidden = t !== 'src'; $('lineCanvas').hidden = t !== 'line'; $('glwrap').hidden = t !== '3d';
  if (t === 'src') drawSrc(); if (t === 'line') drawLine(); if (t === '3d') view.resize();
  drawLegend();
}
document.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- source image ----------
let srcImg = null, crop = null, strokes = [];
function makeSample() {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 1050;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = x.fillStyle = '#1d1d1d'; x.lineCap = 'round'; x.lineJoin = 'round';
  // branch
  x.lineWidth = 16; x.beginPath(); x.moveTo(40, 820); x.bezierCurveTo(300, 760, 620, 860, 960, 760); x.stroke();
  // leaves (thin outlines)
  x.lineWidth = 2.5;
  for (const [lx, ly, a] of [[150, 795, -0.6], [560, 790, -2.4], [880, 778, -0.4]]) {
    x.save(); x.translate(lx, ly); x.rotate(a); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(40, -45, 95, -10); x.quadraticCurveTo(40, 25, 0, 0); x.stroke();
    x.beginPath(); x.moveTo(5, -2); x.lineTo(80, -10); x.stroke(); x.restore(); }
  // bird 1 (filled)
  x.save(); x.translate(370, 640); x.rotate(-0.15);
  x.beginPath(); x.ellipse(0, 0, 125, 88, 0, 0, 7); x.fill();
  x.beginPath(); x.arc(-105, -80, 58, 0, 7); x.fill();
  x.beginPath(); x.moveTo(-160, -95); x.lineTo(-215, -70); x.lineTo(-158, -60); x.fill();
  x.beginPath(); x.moveTo(110, -10); x.lineTo(215, -55); x.lineTo(200, 10); x.lineTo(110, 40); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(-118, -92, 9, 0, 7); x.fill();
  x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.moveTo(-40, -20); x.quadraticCurveTo(30, -50, 90, -10); x.stroke();
  x.restore(); x.fillStyle = x.strokeStyle = '#1d1d1d';
  x.lineWidth = 4; x.beginPath(); x.moveTo(350, 725); x.lineTo(345, 795); x.moveTo(400, 722); x.lineTo(405, 800); x.stroke();
  // bird 2 (outline)
  x.save(); x.translate(660, 600); x.rotate(0.12); x.lineWidth = 7;
  x.beginPath(); x.ellipse(0, 0, 115, 82, 0, 0, 7); x.stroke();
  x.beginPath(); x.arc(98, -78, 52, 0, 7); x.stroke();
  x.beginPath(); x.moveTo(146, -92); x.lineTo(196, -70); x.lineTo(144, -58); x.stroke();
  x.beginPath(); x.arc(108, -88, 8, 0, 7); x.fill();
  x.lineWidth = 3.5; x.beginPath(); x.moveTo(-60, -10); x.bezierCurveTo(-10, -60, 40, -40, 60, 10); x.bezierCurveTo(10, 20, -30, 20, -60, -10); x.stroke();
  x.lineWidth = 6; x.beginPath(); x.moveTo(-112, 10); x.lineTo(-200, -30); x.lineTo(-185, 30); x.closePath(); x.stroke();
  x.restore();
  x.lineWidth = 4; x.beginPath(); x.moveTo(640, 690); x.lineTo(636, 790); x.moveTo(690, 690); x.lineTo(694, 795); x.stroke();
  // heart between them, faint pencil
  x.strokeStyle = '#8a8a8a'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(515, 420); x.bezierCurveTo(440, 360, 470, 290, 515, 330); x.bezierCurveTo(560, 290, 590, 360, 515, 420); x.stroke();
  x.lineWidth = 2; x.beginPath(); x.moveTo(470, 470); x.quadraticCurveTo(515, 450, 560, 470); x.stroke();
  return c;
}
function setSource(img, name) {
  srcImg = img; crop = null; strokes = [];
  $('srcName').textContent = name;
  invalidate(1);
}
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });
function loadFile(f) {
  if (!f.type.startsWith('image/')) { toast('请选择图片文件（JPG、PNG 等）。'); return; }
  const url = URL.createObjectURL(f), im = new Image();
  im.onload = () => { const c = document.createElement('canvas'); const k = Math.min(1, 3000 / Math.max(im.width, im.height));
    c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); setSource(c, f.name); showTab('line'); };
  im.onerror = () => toast('这张图片打不开，换一张试试。');
  im.src = url;
}
const drop = $('drop');
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$('useSample').addEventListener('click', () => setSource(makeSample(), '现在显示的是示例图'));
$('resetCrop').addEventListener('click', () => { crop = null; invalidate(1); drawSrc(); });

// fit helper
function fitCanvas(cv, w, h) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  const pad = 14 * dpr, k = Math.min((cv.width - 2 * pad) / w, (cv.height - 2 * pad) / h);
  return { k, ox: (cv.width - w * k) / 2, oy: (cv.height - h * k) / 2, dpr };
}
let srcFit = null, drag = null;
function drawSrc() {
  const cv = $('srcCanvas'); if (cv.hidden || !srcImg) return;
  const f = srcFit = fitCanvas(cv, srcImg.width, srcImg.height), x = cv.getContext('2d');
  x.fillStyle = css('--bed'); x.fillRect(0, 0, cv.width, cv.height);
  x.drawImage(srcImg, f.ox, f.oy, srcImg.width * f.k, srcImg.height * f.k);
  const c = drag ? norm(drag) : crop;
  if (c) {
    const X0 = f.ox + c.x0 * srcImg.width * f.k, Y0 = f.oy + c.y0 * srcImg.height * f.k, X1 = f.ox + c.x1 * srcImg.width * f.k, Y1 = f.oy + c.y1 * srcImg.height * f.k;
    x.fillStyle = 'rgba(0,0,0,.45)';
    x.fillRect(f.ox, f.oy, srcImg.width * f.k, Y0 - f.oy); x.fillRect(f.ox, Y1, srcImg.width * f.k, f.oy + srcImg.height * f.k - Y1);
    x.fillRect(f.ox, Y0, X0 - f.ox, Y1 - Y0); x.fillRect(X1, Y0, f.ox + srcImg.width * f.k - X1, Y1 - Y0);
    x.strokeStyle = css('--accent'); x.lineWidth = 2 * f.dpr; x.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
  }
}
const norm = d => ({ x0: Math.min(d.a[0], d.b[0]), y0: Math.min(d.a[1], d.b[1]), x1: Math.max(d.a[0], d.b[0]), y1: Math.max(d.a[1], d.b[1]) });
function srcPt(e) {
  const cv = $('srcCanvas'), r = cv.getBoundingClientRect(), f = srcFit;
  const px = (e.clientX - r.left) * f.dpr, py = (e.clientY - r.top) * f.dpr;
  return [Math.min(1, Math.max(0, (px - f.ox) / (srcImg.width * f.k))), Math.min(1, Math.max(0, (py - f.oy) / (srcImg.height * f.k)))];
}
$('srcCanvas').addEventListener('pointerdown', e => { if (!srcFit) return; e.target.setPointerCapture(e.pointerId); drag = { a: srcPt(e), b: srcPt(e) }; });
$('srcCanvas').addEventListener('pointermove', e => { if (!drag) return; drag.b = srcPt(e); drawSrc(); });
$('srcCanvas').addEventListener('pointerup', () => {
  if (!drag) return; const c = norm(drag); drag = null;
  if ((c.x1 - c.x0) * srcImg.width > 20 && (c.y1 - c.y0) * srcImg.height > 20) {
    // keep crop in absolute source coords
    const old = crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
    crop = c; invalidate(1); void old;
  }
  drawSrc();
});

// ---------- line canvas & brush ----------
let lineFit = null, painting = null, hover = null;
function drawLine() {
  const cv = $('lineCanvas'); if (cv.hidden || !cache.mask) return;
  const { W, H, mask, bw } = cache, f = lineFit = fitCanvas(cv, W, H), x = cv.getContext('2d');
  x.fillStyle = css('--bed'); x.fillRect(0, 0, cv.width, cv.height);
  const img = new ImageData(W, H), d = img.data;
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const paper = hex(css('--paper')), ink = hex(css('--stroke')), add = hex(css('--added')), rem = hex(css('--removed'));
  for (let i = 0; i < W * H; i++) {
    const c = mask[i] ? (bw[i] ? ink : add) : (bw[i] ? rem : paper);
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(img, 0, 0);
  x.imageSmoothingEnabled = true; x.drawImage(tmp, f.ox, f.oy, W * f.k, H * f.k);
  if (painting) { x.strokeStyle = painting.mode === 'erase' ? '#ffffff' : css('--stroke'); x.lineCap = x.lineJoin = 'round'; x.lineWidth = 2 * painting.rmm / cache.s * f.k;
    x.beginPath(); painting.pts.forEach((p, i) => { const X = f.ox + p[0] * W * f.k, Y = f.oy + p[1] * H * f.k; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke(); }
  if (hover && seg.brush !== 'off') { x.strokeStyle = css('--accent'); x.lineWidth = 1.5 * f.dpr; x.beginPath();
    x.arc(f.ox + hover[0] * W * f.k, f.oy + hover[1] * H * f.k, brushMM() / cache.s * f.k, 0, 7); x.stroke(); }
}
const brushMM = () => +$('brushSize').value / 2;
const toSrc = q => [cache.ec.x0 + q[0] * (cache.ec.x1 - cache.ec.x0), cache.ec.y0 + q[1] * (cache.ec.y1 - cache.ec.y0)];
function linePt(e) { const cv = $('lineCanvas'), r = cv.getBoundingClientRect(), f = lineFit;
  return [((e.clientX - r.left) * f.dpr - f.ox) / (cache.W * f.k), ((e.clientY - r.top) * f.dpr - f.oy) / (cache.H * f.k)]; }
const lc = $('lineCanvas');
lc.addEventListener('pointerdown', e => { if (seg.brush === 'off' || !lineFit) return; lc.setPointerCapture(e.pointerId);
  painting = { mode: seg.brush, rmm: brushMM(), pts: [linePt(e)] }; drawLine(); });
lc.addEventListener('pointermove', e => { if (!lineFit) return; hover = linePt(e); if (painting) painting.pts.push(hover); if (seg.brush !== 'off') drawLine(); });
lc.addEventListener('pointerleave', () => { hover = null; drawLine(); });
lc.addEventListener('pointerup', () => { if (!painting) return; strokes.push({ mode: painting.mode, rmm: painting.rmm, pts: painting.pts.map(toSrc) }); painting = null; invalidate(2); });
$('undoBrush').addEventListener('click', () => { strokes.pop(); invalidate(2); });
$('clearBrush').addEventListener('click', () => { strokes = []; invalidate(2); });

// ---------- fonts ----------
const fonts = {};
const FONT_FILES = { script: 'fonts/DancingScript-Bold.ttf', serif: 'fonts/DejaVuSerif-Bold.ttf', sans: 'fonts/Inter-SemiBold.otf' };
const fontsReady = Promise.all(Object.entries(FONT_FILES).map(async ([k, url]) => {
  try { fonts[k] = opentype.parse(await (await fetch(url)).arrayBuffer()); } catch (e) { console.warn('font', k, e); }
}));
$('fontFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { fonts.custom = opentype.parse(await f.arrayBuffer());
    const o = $('font').querySelector('[value=custom]'); o.disabled = false; o.textContent = '上传的字体：' + f.name;
    $('font').value = 'custom'; toast('字体已载入：' + f.name); invalidate(4);
  } catch (err) { toast('这个字体文件读不出来。请用 .ttf 或 .otf 格式（不支持 .woff2）。'); }
});
document.querySelector('label[for=fontFile]').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fontFile').click(); } });

// ---------- pipeline ----------
const cache = {};
let dirty = 1, timer = 0, running = false;
function invalidate(level) { dirty = Math.min(dirty, level); clearTimeout(timer); timer = setTimeout(run, 200); }
async function run() {
  if (running) { timer = setTimeout(run, 150); return; }
  if (!srcImg) return;
  running = true; $('busy').hidden = false; await frame();
  const lvl = dirty; dirty = 9; const p = P();
  try {
    if (lvl <= 2) { $('busy').textContent = '转成黑白…'; await frame();
      stage1(p, crop || { x0: 0, y0: 0, x1: 1, y1: 1 }); stage2(p);
      const t = trimmedCrop(cache.bw, cache.W, cache.H, cache.ec);
      if (t) { stage1(p, t); stage2(p); } }
    if (lvl <= 3) { $('busy').textContent = '整理线条…'; await frame(); stage3(p); drawLine(); }
    if (lvl <= 4) { $('busy').textContent = '生成模型…'; await frame(); await stage4(p); }
  } catch (err) { console.error(err); setWarnings(['处理时出错：' + (err && err.message || err)]); }
  $('busy').textContent = '处理中…'; $('busy').hidden = true; running = false;
  if (tab === 'src') drawSrc();
}

function stage1(p, c) {
  const sx = c.x0 * srcImg.width, sy = c.y0 * srcImg.height, sw = (c.x1 - c.x0) * srcImg.width, sh = (c.y1 - c.y0) * srcImg.height;
  let W = Math.min(1600, Math.round(p.width / 0.1)), H = Math.round(W * sh / sw);
  if (H > 2000) { W = Math.round(W * 2000 / H); H = 2000; }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.imageSmoothingQuality = 'high'; x.drawImage(srcImg, sx, sy, sw, sh, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  Object.assign(cache, { gray, W, H, s: p.width / W, ec: c });
}
// trim empty margins so "图案宽度" is the width of the drawing itself
function trimmedCrop(bw, W, H, c) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bw[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 3; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  if (x0 < 6 && y0 < 6 && x1 > W - 7 && y1 > H - 7) return null;
  const cw = c.x1 - c.x0, ch = c.y1 - c.y0;
  return { x0: c.x0 + cw * x0 / W, x1: c.x0 + cw * (x1 + 1) / W, y0: c.y0 + ch * y0 / H, y1: c.y0 + ch * (y1 + 1) / H };
}
function stage2(p) {
  const { gray, W, H, s, ec } = cache;
  if (p.thMode === 'auto') { cache.autoTh = autoThreshold(gaussBlur(gray, W, H, 0.8)); $('threshold').value = cache.autoTh; $('threshold').dispatchEvent(new Event('show')); document.querySelector('output[for=threshold]').textContent = cache.autoTh; }
  const m = binarize(gray, W, H, p, s);
  applyEdits(m, W, H, s, ec, strokes);
  removeSpecks(m, W, H, p.speck / (s * s));
  cache.bw = dilate(m, W, H, 1);
}
function stage3(p) {
  const { W, H, s } = cache; let m = cache.bw.slice();
  const stats = {};
  if (p.kind === 'cutout' && p.bar) addBottomBar(m, W, H, Math.round(4 / s));
  const rMin = Math.max(1, Math.floor(p.minWidth / (2 * s))), bridgeR = Math.max(rMin + 1, Math.round(0.45 / s));
  // a relief plaque holds every line on its plate, so islands are fine there
  const islands = p.kind === 'plaque' ? 'keep' : p.islands;
  if (islands !== 'remove') m = thickenThin(m, W, H, rMin);
  if (islands !== 'keep') m = resolveIslands(m, W, H, rMin, bridgeR, islands, stats);
  let field;
  if (p.smooth) field = uniformLines(m, W, H, s, { lineWidth: Math.max(p.lineWidth, p.minWidth), smoothness: p.smoothness });
  else field = maskToField(m, W, H, 0.07 / s);
  let mask = fieldToMask(field);
  const fixed = islands === 'keep' ? mask : resolveIslands(mask, W, H, rMin, bridgeR, islands, {});
  for (let i = 0; i < mask.length; i++) { if (fixed[i] && !mask[i]) field[i] = 1; if (!fixed[i] && mask[i]) field[i] = 0; }
  mask = fixed;
  const pieces = label(opening(mask, W, H, rMin), W, H).n;
  Object.assign(cache, { field, mask, pieces, rMin, stats, kind: p.kind });
}
let built = null;
async function stage4(p) {
  await Promise.all([initManifold(), fontsReady]);
  collectGarbage();
  const { field, W, H, s } = cache;
  const art = fieldToCrossSection(field, W, H, s);
  if (!art) { built = null; view.show([]); setWarnings(['没有识别到线条。试试调整灵敏度或勾选反相。']); updateStatus(p); return; }
  built = buildModels(art, p, fonts);
  built.meshes = built.parts.map(pt => ({ ...pt, arrays: meshArrays(pt.manifold) }));
  const show = [];
  for (const pt of built.parts) {
    if (pt.view) for (const v of pt.view) show.push({ arrays: meshArrays(v.m), role: v.role });
    else if (pt.viewM) show.push({ arrays: meshArrays(pt.viewM), role: pt.role });
    else show.push({ arrays: meshArrays(pt.manifold), role: pt.role });
  }
  if (p.kind === 'plaque') for (const it of show) if (it.role === 'panel') {
    const pos = it.arrays.pos;
    if (p.base === 'none') it.tint = v => pos[v * 3 + 2] > p.plateT + 0.05;
    else { let ymin = Infinity; for (let i = 1; i < pos.length; i += 3) ymin = Math.min(ymin, pos[i]); it.tint = v => pos[v * 3 + 1] < ymin + p.reliefH - 0.05; }
  }
  view.show(show);
  setWarnings(built.warnings);
  updateStatus(p);
  renderFiles(p);
}

// ---------- status ----------
function setWarnings(list) { const ul = $('warnings'); ul.innerHTML = ''; for (const w of list) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); } }
function updateStatus(p) {
  const st = $('status'); st.innerHTML = '';
  const add = (html) => { const s = document.createElement('span'); s.innerHTML = html; st.appendChild(s); };
  const { W, H, s, pieces, stats } = cache;
  add(`图案 <b>${(W * s).toFixed(0)} × ${(H * s).toFixed(0)} mm</b>`);
  if (cache.kind === 'plaque') add('<span class="pill ok">线条都在底板上</span>');
  else add(pieces === 1 ? '<span class="pill ok">线条连成一整块</span>' : `<span class="pill warn">${pieces} 块分离</span>`);
  add(`最细处 ≥ <b>${((2 * cache.rMin + 1) * s).toFixed(1)} mm</b>`);
  if (stats && stats.bridges) add(`补了 <b>${stats.bridges}</b> 处连接`);
  if (stats && stats.dropped) add(`删了 <b>${stats.dropped}</b> 条孤立线`);
  if (built) add(`模型 <b>${built.dims.map(v => v.toFixed(0)).join(' × ')} mm</b>`);
}
function renderFiles(p) {
  const fl = $('fileList'); fl.innerHTML = '';
  if (!built) return;
  for (const m of built.meshes) {
    const d = dimsOf(m.manifold).map(v => v.toFixed(0)).join('×');
    const row = document.createElement('div'); row.className = 'file';
    row.innerHTML = `<code></code><span></span><button type="button">STL</button>`; row.querySelector('code').textContent = m.file; row.querySelector('span').textContent = `${m.name} · ${d} mm`;
    row.querySelector('button').addEventListener('click', () => save(m.file, stlBinary(m.manifold)));
    fl.appendChild(row);
  }
}

// ---------- 3D viewer ----------
const view = (() => {
  const wrap = $('glwrap');
  let renderer = null, scene, camera, controls, group, raf = 0;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (e) { wrap.textContent = '这个浏览器不支持 WebGL，无法显示 3D 预览，但仍可以下载模型。'; }
  if (renderer) {
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    wrap.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 1, 5000); camera.up.set(0, 0, 1);
    controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.75); dl.position.set(-0.6, -1, 1.3); scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.25); dl2.position.set(1, 0.8, 0.4); scene.add(dl2);
    group = new THREE.Group(); scene.add(group);
    new ResizeObserver(() => resize()).observe(wrap);
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }; loop();
  }
  const colors = { panel: 0xefe9de, base: 0x48524d, combo: 0xefe9de };
  function resize() { if (!renderer) return; const r = wrap.getBoundingClientRect(); if (!r.width) return;
    renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
  function show(list) {
    if (!renderer) return;
    scene.background = new THREE.Color(css('--bed') || '#e3e7e1');
    while (group.children.length) { const c = group.children.pop(); c.geometry && c.geometry.dispose(); }
    const box = new THREE.Box3();
    for (const it of list) {
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(it.arrays.pos, 3)); g.setIndex(new THREE.BufferAttribute(it.arrays.idx, 1));
      if (it.tint) { const nv = it.arrays.pos.length / 3, col = new Float32Array(nv * 3), a = new THREE.Color(colors.panel), b = new THREE.Color(0x2f3532);
        for (let v = 0; v < nv; v++) { const c = it.tint(v) ? b : a; col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
      g = g.toNonIndexed(); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: it.tint ? 0xffffff : (colors[it.role] || 0xefe9de), vertexColors: !!it.tint, roughness: 0.6, metalness: 0.02 }));
      group.add(mesh); box.expandByObject(mesh);
    }
    if (box.isEmpty()) return;
    // ground grid at z = min
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    const grid = new THREE.GridHelper(Math.ceil(span * 1.6 / 10) * 10, Math.ceil(span * 1.6 / 10), new THREE.Color(css('--grid-a') || '#9aa29d'), new THREE.Color(css('--grid-b') || '#c9cec9'));
    grid.rotation.x = Math.PI / 2; grid.position.set(c.x, c.y, box.min.z - 0.05); 
    group.add(grid);
    const flat = size.z < Math.min(size.x, size.y) * 0.2;
    const dir = flat ? new THREE.Vector3(-0.35, -1.0, 1.6) : new THREE.Vector3(-0.55, -1.25, 0.55);
    resize();
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    dir.normalize().multiplyScalar(size.length() / 2 / Math.sin(Math.min(vf, hf) / 2) * 1.02);
    controls.target.copy(c); camera.position.copy(c).add(dir); camera.near = span / 50; camera.far = span * 20; camera.updateProjectionMatrix();
    resize();
  }
  function snapshot() { return new Promise(r => { renderer.render(scene, camera); renderer.domElement.toBlob(b => r(b), 'image/png'); }); }
  return { show, resize, snapshot, ok: () => !!renderer };
})();
function drawLegend() {
  const lg = $('legend'); lg.innerHTML = '';
  if (tab === 'line') { lg.hidden = false; lg.innerHTML = `<span><i style="background:var(--stroke)"></i>线条</span><span><i style="background:var(--added)"></i>加粗/补接</span><span><i style="background:var(--removed)"></i>去掉</span>`; }
  else if (tab === '3d' && P().base !== 'none') { lg.hidden = false; lg.innerHTML = `<span><i style="background:#efe9de;border:1px solid var(--line)"></i>图案</span><span><i style="background:#48524d"></i>底座</span>`; }
  else lg.hidden = true;
}

// ---------- export ----------
function toast(t) { $('toast').textContent = t; }
async function save(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('已下载：' + filename); return true;
}
function lineartPNG() {
  return new Promise(r => {
    const { W, H, mask } = cache, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), img = x.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = mask[i] ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0); c.toBlob(r, 'image/png');
  });
}
function notes(p) {
  const L = [];
  L.push('线稿立体工坊 · 打印说明', '');
  for (const m of built.meshes) L.push(`${m.file}  —  ${m.name}，${dimsOf(m.manifold).map(v => v.toFixed(1)).join(' × ')} mm`);
  L.push('');
  if (p.base === 'separate') L.push(`图案平放打印；底座正放打印。卡槽 ${built.slot.w.toFixed(2)} × ${built.slot.t.toFixed(2)} mm，深 ${built.slot.depth.toFixed(1)} mm（每边留 ${p.clearance} mm 间隙）。太松可以滴一点胶。`);
  if (p.base === 'onepiece') L.push('一体式：底座朝下直接打印。图案较薄，建议降低打印速度。');
  if (p.base === 'none') L.push('平放打印，不需要支撑。');
  if (p.kind === 'plaque') L.push(`浮雕牌：打到 ${p.plateT} mm 高度时换色，底板和线条就是两种颜色。`);
  L.push(`线条最细处约 ${((2 * cache.rMin + 1) * cache.s).toFixed(1)} mm，用 0.4 mm 喷嘴可以打印。`);
  if (p.text1 || p.text2) L.push('刻字较小，建议层高 0.1–0.12 mm。');
  return L.join('\r\n');
}
$('dlZip').addEventListener('click', async () => {
  if (!built) return; const p = P();
  const files = built.meshes.map(m => ({ name: m.file, data: stlBinary(m.manifold) }));
  const enc = new TextEncoder();
  files.push({ name: 'lineart.png', data: new Uint8Array(await (await lineartPNG()).arrayBuffer()) });
  if (view.ok()) { const was = tab; if (tab !== '3d') showTab('3d'); await frame(); files.push({ name: 'preview.png', data: new Uint8Array(await (await view.snapshot()).arrayBuffer()) }); if (was !== '3d') showTab(was); }
  files.push({ name: 'print-notes.txt', data: enc.encode('﻿' + notes(p)) });
  await save('lineart-3d-model.zip', makeZip(files));
});
$('dlShot').addEventListener('click', async () => { if (!view.ok() || !built) return; const was = tab; if (tab !== '3d') showTab('3d'); await frame(); const b = await view.snapshot(); if (was !== '3d') showTab(was); await save('preview.png', b); });
$('dlLine').addEventListener('click', async () => { if (!cache.mask) return; await save('lineart.png', await lineartPNG()); });

// ---------- boot ----------
window.addEventListener('resize', () => { if (tab === 'src') drawSrc(); if (tab === 'line') drawLine(); });
syncUI(); showTab('3d');
setSource(makeSample(), '现在显示的是示例图');
window.__app = window.__app || {}; Object.assign(window.__app, { cache, P, get built() { return built; }, setSource, loadFile, run, invalidate, view });
})();
