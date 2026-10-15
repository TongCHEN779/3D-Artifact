// ===== App: UI, pipeline orchestration, viewer, export =====
(function () {
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- params ----------
const fmt = {
  threshold: v => v, adaptC: v => v, speck: v => v + ' mm²', lineWidth: v => (+v).toFixed(2) + ' mm',
  smoothness: v => (+v).toFixed(2), minWidth: v => (+v).toFixed(2) + ' mm', brushSize: v => v + ' mm',
  detail: v => v + '%', width: v => v + ' mm', thick: v => v + ' mm',
  baseD: v => v + ' mm', baseH: v => v + ' mm', overhang: v => v + ' mm', insert: v => v + ' mm', clearance: v => (+v).toFixed(2) + ' mm',
  smoothDetail: v => '误差 < ' + smoothTol({ smoothDetail: v / 100 }).toFixed(3) + ' mm', tMin: v => (+v).toFixed(1) + ' mm', tMax: v => (+v).toFixed(1) + ' mm', gamma: v => (+v).toFixed(2), frame: v => (+v).toFixed(1) + ' mm', bulge: v => +v ? (+v).toFixed(1) + ' mm' : '平板',
  layer: v => (+v).toFixed(2) + ' mm', edgeSmooth: v => +v ? (+v).toFixed(2) + ' mm' : '不平滑', denoise: v => +v ? v + '%' : '关', textH: v => (+v).toFixed(1) + ' mm', textD: v => (+v).toFixed(1) + ' mm',
};
const stageOf = {
  width: 1, thMode: 2, threshold: 2, adaptC: 2, invert: 2, speck: 2,
  islands: 3, lineMode: 2, edgeSmooth: 3, smooth: 3, lineWidth: 3, smoothness: 3, minWidth: 3, kind: 3, bar: 3,
  tMin: 4, tMax: 4, gamma: 4, frame: 4, bulge: 4, flip: 4, printAid: 4, smoothDetail: 4, denoise: 4,
  thick: 4, base: 4, baseD: 4, baseH: 4, overhang: 4, insert: 4, clearance: 4, step: 4,
  printer: 4, bedX: 4, bedY: 4, bedZ: 4, nozzle: 3, layer: 3, walls: 3,
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

// ---------- printer ----------
const PRINTERS = { a1mini: [180, 180, 180], a1: [256, 256, 256], mk4: [250, 210, 220], ender3: [220, 220, 250] };
const PRINTER_IDS = ['printer', 'bedX', 'bedY', 'bedZ', 'nozzle', 'layer'];
try { const s = JSON.parse(localStorage.getItem('printer') || 'null'); if (s) { for (const k of PRINTER_IDS) if (s[k] != null && $(k)) $(k).value = s[k]; if (s.walls) setSeg('walls', s.walls); } } catch (e) {}
if ($('layer')) document.querySelector('output[for=layer]').textContent = fmt.layer($('layer').value);
['bedX', 'bedY', 'bedZ'].forEach(id => $(id).addEventListener('change', () => onChange(id)));
function savePrinter() { try { const s = { walls: seg.walls }; for (const k of PRINTER_IDS) s[k] = $(k).value; localStorage.setItem('printer', JSON.stringify(s)); } catch (e) {} }
// What the printer can actually make, derived from nozzle, layer height and wall count.
function printerRules() {
  const d = +$('nozzle').value || 0.4, h = +$('layer').value || 0.2, walls = +seg.walls || 2;
  const pid = $('printer').value, bed = pid === 'custom' ? [+$('bedX').value || 200, +$('bedY').value || 200, +$('bedZ').value || 200] : PRINTERS[pid];
  const lineW = Math.round(d * 1.05 * 100) / 100;                       // usual extrusion width
  return { d, h, walls, bed, lineW,
    minLine: Math.round((walls >= 2 ? 2 * lineW : 1.1 * d) * 100) / 100, // narrowest line that prints solid
    minGap: d,                                                             // narrower gaps close up
    minStroke: lineW };                                                    // text strokes
}

function P() {
  const p = rawP(), r = printerRules(), adj = [];
  // apply every rule; report only the ones that matter for the chosen model type
  const up = (key, v, label, show) => { if (v > p[key] + 1e-9) { if (show) adj.push(`${label} ${(+p[key]).toFixed(2)} → ${v.toFixed(2)} mm`); p[key] = v; } };
  const snap = (key, label, show) => {   // whole layers, at least two
    const v = Math.max(2 * r.h, Math.round(p[key] / r.h) * r.h);
    if (Math.abs(v - p[key]) > 1e-6) { if (show) adj.push(`${label} ${(+p[key]).toFixed(2)} → ${v.toFixed(2)} mm（按层高取整）`); p[key] = v; }
  };
  const K = p.kind, lines = K !== 'litho';
  up('minWidth', r.minLine, '最细线宽', lines); up('lineWidth', p.minWidth, '线宽', lines && p.smooth);
  snap('thick', '剪影厚度', K === 'cutout');
  up('tMin', Math.round(2 * r.d * 100) / 100, '透光最薄', !lines); if (p.tMax < p.tMin + 0.4) p.tMax = p.tMin + 0.4;
  if (p.frame > 0) up('frame', 2 * r.lineW, '边框宽度', !lines);
  snap('baseH', '底座高度', p.base !== 'none'); snap('textD', '刻字深度', !!(p.text1 || p.text2));
  p.printer = r; p.minGap = r.minGap; p.adjusted = adj;
  return p;
}
function rawP() {
  const n = id => +$(id).value;
  return {
    width: n('width'), method: 'threshold', thMode: seg.thMode, threshold: n('threshold'), adaptC: n('adaptC'), invert: $('invert').checked, speck: n('speck'),
    islands: seg.islands, smooth: seg.lineMode === 'uniform', lineMode: seg.lineMode, edgeSmooth: n('edgeSmooth'), lineWidth: n('lineWidth'), smoothness: n('smoothness'), minWidth: n('minWidth'),
    kind: seg.kind, tMin: n('tMin'), tMax: Math.max(n('tMax'), n('tMin') + 0.4), gamma: n('gamma'), frame: n('frame'), bulge: n('bulge'), flip: $('flip').checked, printAid: $('printAid').checked, denoise: n('denoise'), smoothDetail: n('smoothDetail') / 100,
    thick: n('thick'), bar: $('bar').checked,
    base: seg.base, baseD: n('baseD'), baseH: n('baseH'), overhang: n('overhang'), insert: n('insert'), clearance: n('clearance'), step: $('step').checked,
    text1: $('text1').value.trim(), text2: $('text2').value.trim(), font: $('font').value, textH: n('textH'), textD: n('textD'),
  };
}

function syncUI() {
  const p = P();
  $('lineHint').textContent = p.smooth ? '沿每条线的中心重新画一遍，线宽统一、曲线顺滑。适合照片、铅笔稿等线条粗细不匀的图；细节多的图会丢掉一些小线条。'
    : '保留原图每条线的形状和粗细，只把边缘磨平，太细的地方加粗到能打印。适合已经是干净线稿的图。';
  $('printerSum').textContent = `${$('printer').selectedOptions[0].textContent.replace(/（.*）/, '')} · ${p.printer.d} mm 喷嘴 · ${p.printer.h.toFixed(2)} mm 层高 · ${p.printer.walls} 圈墙`;
  updateWidthHint(p);
  // every control that only applies in some situations carries its rule in data-show (see page markup)
  document.querySelectorAll('[data-show]').forEach(el => {
    const f = el._show || (el._show = new Function('p', 'seg', '$', 'return (' + el.dataset.show + ');'));
    el.hidden = !f(p, seg, $);
  });
  const litho = p.kind === 'litho';
  $('s2body').hidden = litho; $('s2note').hidden = true;
  $('s2').closest('section').hidden = litho;   // a lithophane uses the photo directly — no line-art step
  let k = 0; document.querySelectorAll('.controls > .step').forEach(sec => { if (!sec.hidden) sec.querySelector('h2 .n').textContent = ++k; });
  if (litho) $('facetHint').textContent = `网格会一直加密，直到每一处与照片的误差都小于 ${smoothTol(p).toFixed(3)} mm，看不出棱角。精度越高细节越多，计算越慢、文件越大（最高精度可能需要半分钟以上，STL 可达上百 MB）。照片本身的分辨率是上限。`;
  document.querySelector('[data-tab=line]').textContent = litho ? '透光预览' : '线稿';
  $('dlLine').textContent = litho ? '保存透光预览' : '保存线稿';
  $('t1label').textContent = '底座正面';
  const r = p.printer;
  $('printerNote').textContent = `线条 ≥ ${r.minLine.toFixed(2)} mm · 缝隙 ≥ ${r.minGap} mm · 文字笔画 ≥ ${r.minStroke.toFixed(2)} mm · 高度按 ${r.h.toFixed(2)} mm 层高取整` +
    (p.adjusted.length ? '。已自动调整：' + p.adjusted.join('；') + '。' : '');
  if (typeof drawLegend === "function") drawLegend();
}

function onChange(id) {
  if (PRINTER_IDS.includes(id) || id === 'walls') savePrinter();
  syncUI();
  if (id === 'brush') { if (seg.brush !== 'off') showTab('line'); drawLine(); return; }
  if (id === 'brushSize') return;
  if (id === 'kind') { invalidate(seg.kind === 'litho' || cache.kind === 'litho' ? 2 : 3); return; }
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
// typical stroke width of a mask in pixels: twice the distance to the background, sampled on the centre lines
function medianLineWidth(m, W, H) {
  const inv = new Uint8Array(W * H); for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  const { d2 } = edt(inv, W, H), sk = thin(m, W, H), v = [];
  for (let i = 0; i < sk.length; i++) if (sk[i]) v.push(2 * Math.sqrt(d2[i]));
  if (v.length < 20) return 0;
  v.sort((x, y) => x - y); return v[v.length >> 1];
}
let recWidth = 0;
function updateWidthHint(p) {
  const el = $('widthHint'); recWidth = 0;
  if (p.kind === 'litho' || !cache.lineMM || cache.kind === undefined) { el.hidden = true; return; }
  const line = cache.lineMM, need = p.printer.minLine;
  if (line >= need * 0.95) { el.hidden = true; return; }
  const bedMax = Math.max(p.printer.bed[0], p.printer.bed[1]) - 2 * (p.base !== 'none' ? p.overhang : 0) - 4;
  recWidth = Math.min(250, Math.ceil(p.width * need / line / 5) * 5);
  $('widthHintText').textContent = `原图的线大多约 ${line.toFixed(2)} mm 宽，比打印机能打的最细线 ${need.toFixed(2)} mm 还细，会被加粗，密的地方（脸、文字）容易糊在一起。建议图案宽度 ≥ ${recWidth} mm` + (recWidth > bedMax ? `（超过打印机可用的约 ${Math.max(0, Math.floor(bedMax))} mm，可以只框选一部分，或换小喷嘴）。` : '。');
  el.hidden = false;
}
$('useRecWidth').addEventListener('click', () => { if (!recWidth) return; $('width').value = recWidth; $('width').dispatchEvent(new Event('input')); });
// clean line art (almost only black and white) keeps its own lines; photos and sketches get redrawn
function guessLineMode(img) {
  const k = Math.min(1, 400 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data; let mid = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; if (v > 60 && v < 200) mid++; }
  return mid / n < 0.1 ? 'keep' : 'uniform';
}
function setSource(img, name) {
  setSeg('lineMode', guessLineMode(img));
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
  const cv0 = $('lineCanvas');
  if (!cv0.hidden && P().kind === 'litho') {
    if (!cache.litho) return;
    const pv = lithoPreview(cache.litho.tri, P()), f = lineFit = fitCanvas(cv0, pv.width, pv.height), x = cv0.getContext('2d');
    x.fillStyle = css('--bed'); x.fillRect(0, 0, cv0.width, cv0.height); x.imageSmoothingEnabled = true;
    x.drawImage(pv, f.ox, f.oy, pv.width * f.k, pv.height * f.k); return;
  }
  const cv = $('lineCanvas'); if (cv.hidden || !cache.mask) return;
  const { W, H, mask } = cache, bw = cache.bw, f = lineFit = fitCanvas(cv, W, H), x = cv.getContext('2d');
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
    if (p.kind === 'litho') {
      if (lvl <= 2) { stage1(p, crop || { x0: 0, y0: 0, x1: 1, y1: 1 }); cache.kind = 'litho'; }
      if (lvl <= 4) { $('busy').textContent = '计算多面体…'; await frame(); await stage4(p); drawLine(); }
    } else {
    if (lvl <= 2) { $('busy').textContent = '转成黑白…'; await frame();
      stage1(p, crop || { x0: 0, y0: 0, x1: 1, y1: 1 }); stage2(p);
      const t = trimmedCrop(cache.bw, cache.W, cache.H, cache.ec);
      if (t) { stage1(p, t); stage2(p); } }
    if (lvl <= 3) { $('busy').textContent = '整理线条…'; await frame(); stage3(p); drawLine(); }
    if (lvl <= 4) { $('busy').textContent = '生成模型…'; await frame(); await stage4(p); }
    }
  } catch (err) { console.error(err); setWarnings(['处理时出错：' + (err && err.message || err)]); }
  $('busy').textContent = '处理中…'; $('busy').hidden = true; running = false;
  if (tab === 'src') drawSrc();
}

function stage1(p, c) {
  const sx = c.x0 * srcImg.width, sy = c.y0 * srcImg.height, sw = (c.x1 - c.x0) * srcImg.width, sh = (c.y1 - c.y0) * srcImg.height;
  // lithophanes keep the photo's own resolution (up to 3000 px) so the fine mesh has detail to follow
  const cap = p.kind === 'litho' ? 3000 : 1600, capH = p.kind === 'litho' ? 3000 : 2000;
  let W = p.kind === 'litho' ? Math.min(cap, Math.round(sw)) : Math.min(cap, Math.round(p.width / 0.1)), H = Math.round(W * sh / sw);
  if (H > capH) { W = Math.round(W * capH / H); H = capH; }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.imageSmoothingQuality = 'high'; x.drawImage(srcImg, sx, sy, sw, sh, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  Object.assign(cache, { gray, W, H, s: p.width / W, ec: c, color: cv });
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
  if (p.thMode === 'auto') { const gb = gaussBlur(gray, W, H, 0.8); cache.autoTh = p.lineMode === 'keep' ? otsu(gb) : autoThreshold(gb); $('threshold').value = cache.autoTh; $('threshold').dispatchEvent(new Event('show')); document.querySelector('output[for=threshold]').textContent = cache.autoTh; }
  const m = binarize(gray, W, H, p, s);
  applyEdits(m, W, H, s, ec, strokes);
  removeSpecks(m, W, H, p.speck / (s * s));
  cache.lineMM = medianLineWidth(m, W, H) * s;
  cache.bw = p.lineMode === 'uniform' ? dilate(m, W, H, 1) : m;
}
function stage3(p) {
  const { W, H, s } = cache; let m = cache.bw.slice();
  const stats = {};
  if (p.kind === 'cutout' && p.bar) addBottomBar(m, W, H, Math.round(4 / s));
  const rMin = Math.max(1, Math.ceil((p.minWidth / s - 1) / 2)), bridgeR = rMin;   // strokes of 2·rMin+1 px are at least minWidth wide; bridges only as wide as that
  const islands = p.islands;
  if (islands !== 'remove') m = thickenThin(m, W, H, rMin);
  if (islands !== 'keep') m = resolveIslands(m, W, H, rMin, bridgeR, islands, stats);
  let field;
  if (p.smooth) field = uniformLines(m, W, H, s, { lineWidth: Math.max(p.lineWidth, p.minWidth), smoothness: p.smoothness });
  else field = maskToField(m, W, H, Math.max(0.5, p.edgeSmooth / s));   // keep the drawing's own lines, just round off the pixel edges
  let mask = fieldToMask(field);
  const fixed = islands === 'keep' ? mask : resolveIslands(mask, W, H, rMin, bridgeR, islands, {});
  for (let i = 0; i < mask.length; i++) { if (fixed[i] && !mask[i]) field[i] = 1; if (!fixed[i] && mask[i]) field[i] = 0; }
  mask = fixed;
  // gaps narrower than the nozzle can't be printed open — fill them so the model matches what will print
  const rg = Math.ceil(p.minGap / (2 * s) - 0.25);
  if (rg >= 1) {
    const closed = erode(dilate(mask, W, H, rg), W, H, rg);
    let filled = 0; for (let i = 0; i < mask.length; i++) if (closed[i] && !mask[i]) { mask[i] = 1; field[i] = Math.max(field[i], 0.75); filled++; }
    stats.gapsFilled = filled * s * s;
  }
  const pieces = label(rMin > 1 ? opening(mask, W, H, rMin - 1) : mask, W, H).n;
  Object.assign(cache, { field, mask, pieces, rMin, stats, kind: p.kind });
}
let built = null;
async function stage4(p) {
  await Promise.all([initManifold(), fontsReady]);
  collectGarbage();
  const { field, W, H, s } = cache;
  if (p.kind === 'litho') {
    const L = buildLithoPanel(cache.gray, W, H, p, W * s);
    cache.litho = L; cache.kind = 'litho';
    built = buildModels(null, p, fonts, L.panel);
  } else {
    const art = fieldToCrossSection(field, W, H, s);
    if (!art) { built = null; view.show([]); setWarnings(['没有识别到线条。试试调整灵敏度或勾选反相。']); updateStatus(p); return; }
    built = buildModels(art, p, fonts);
  }
  built.meshes = built.parts;   // geometry stays in the kernel; arrays are made only when needed
  const show = [];
  for (const pt of built.parts) {
    if (pt.view) for (const v of pt.view) show.push({ arrays: meshArrays(v.m), role: v.role, M: v.M });
    else for (const q of piecesOf(pt)) show.push({ arrays: meshArrays(q.m), role: pt.role, M: q.M });
  }
  // the lithophane is a continuous surface: shade it smoothly, as it will print
  // (flat shading exaggerates 0.01 mm facet angles into a "frosted" look that no printer reproduces)
  if (p.kind === 'litho') for (const it of show) if (it.role === 'panel' || it.role === 'combo') it.smoothShade = true;
  view.show(show);
  const bed = p.printer.bed;
  for (const m of built.parts) {
    const d = partDims(m), [a1, b1] = [Math.max(d[0], d[1]), Math.min(d[0], d[1])], [a2, b2] = [Math.max(bed[0], bed[1]), Math.min(bed[0], bed[1])];
    if (a1 > a2 || b1 > b2 || d[2] > bed[2]) built.warnings.push(`${m.file}（${d.map(v => v.toFixed(0)).join(' × ')} mm）超出打印机范围 ${bed.join(' × ')} mm，请缩小图案宽度或底座外伸。`);
  }
  setWarnings(built.warnings);
  updateStatus(p);
  renderFiles(p);
}

// ---------- status ----------
function setWarnings(list) { const ul = $('warnings'); ul.innerHTML = ''; for (const w of list) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); } }
function updateStatus(p) {
  updateWidthHint(p);
  const st = $('status'); st.innerHTML = '';
  const add = (html) => { const s = document.createElement('span'); s.innerHTML = html; st.appendChild(s); };
  const { W, H, s, pieces, stats } = cache;
  add(`图案 <b>${(W * s).toFixed(0)} × ${(H * s).toFixed(0)} mm</b>`);
  if (p.kind === 'litho' && cache.litho) {
    const t = cache.litho.tri;
    add(`<b>${t.pts.length / 2}</b> 个顶点 · <b>${t.tris.length / 3}</b> 个三角面`);
    add(`厚度 <b>${p.tMin.toFixed(1)}–${p.tMax.toFixed(1)} mm</b>`);
    if (p.flip) add(`总厚 <b>${(2 * p.tMax - p.tMin).toFixed(1)} mm</b>（正面凸起）`);
    if (p.bulge > 0) add(`起伏 <b>${p.bulge.toFixed(1)} mm</b>`);
    if (built) add(`模型 <b>${built.dims.map(v => v.toFixed(0)).join(' × ')} mm</b>`);
    return;
  }
  add(pieces === 1 ? '<span class="pill ok">线条连成一整块</span>' : `<span class="pill warn">${pieces} 块分离</span>`);
  add(`最细处 ≥ <b>${((2 * cache.rMin + 1) * s).toFixed(2)} mm</b>`);
  if (stats && stats.gapsFilled > 0.05) add(`填上 <b>${stats.gapsFilled.toFixed(1)} mm²</b> 过窄缝隙`);
  if (stats && stats.bridges) add(`补了 <b>${stats.bridges}</b> 处连接`);
  if (stats && stats.dropped) add(`删了 <b>${stats.dropped}</b> 条孤立线`);
  if (built) add(`模型 <b>${built.dims.map(v => v.toFixed(0)).join(' × ')} mm</b>`);
}
function renderFiles(p) {
  const fl = $('fileList'); fl.innerHTML = '';
  if (!built) return;
  for (const m of built.meshes) {
    const d = partDims(m).map(v => v.toFixed(0)).join('×');
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
      // flat shading needs one copy of every corner (3× the memory); above ~400 k triangles keep the shared
      // vertices and smooth normals instead — at that density it looks the same
      if (!it.smoothShade && it.arrays.idx.length / 3 <= 400000) g = g.toNonIndexed();
      g.computeVertexNormals();
      it.arrays = null;
      const xf = it.M;
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: it.tint ? 0xffffff : (colors[it.role] || 0xefe9de), vertexColors: !!it.tint, roughness: 0.6, metalness: 0.02 }));
      if (xf) { mesh.matrixAutoUpdate = false; mesh.matrix.set(xf[0], xf[1], xf[2], xf[3], xf[4], xf[5], xf[6], xf[7], xf[8], xf[9], xf[10], xf[11], 0, 0, 0, 1); }
      group.add(mesh); mesh.updateMatrixWorld(true); box.expandByObject(mesh);
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
  if (tab === 'line' && P().kind === 'litho') { lg.hidden = false; lg.innerHTML = '<span>模拟背后打光时看到的样子</span>'; }
  else if (tab === 'line') { lg.hidden = false; lg.innerHTML = `<span><i style="background:var(--stroke)"></i>线条</span><span><i style="background:var(--added)"></i>加粗/补接</span><span><i style="background:var(--removed)"></i>去掉</span>`; }
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
  if (P().kind === 'litho' && cache.litho) return new Promise(r => lithoPreview(cache.litho.tri, P()).toBlob(r, 'image/png'));
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
  for (const m of built.meshes) L.push(`${m.file}  —  ${m.name}，${partDims(m).map(v => v.toFixed(1)).join(' × ')} mm`);
  L.push('');
  if (p.base === 'separate') L.push((p.kind === 'litho' ? '透光浮雕单独打印（竖着打印更细腻）；' : '图案平放打印；') + `底座正放打印。卡槽 ${built.slot.w.toFixed(2)} × ${built.slot.t.toFixed(2)} mm，深 ${built.slot.depth.toFixed(1)} mm（每边留 ${p.clearance} mm 间隙）。太松可以滴一点胶。`);
  if (p.base === 'onepiece') L.push('一体式：底座朝下直接打印。图案较薄，建议降低打印速度。');
  if (p.base === 'none') L.push('平放打印，不需要支撑。');
  if (p.kind === 'litho') L.push(`透光浮雕：厚度 ${p.tMin}–${p.tMax} mm，越厚越暗。用白色或浅色 PLA、100% 填充；竖着打印（底边朝下）表面最细腻，平放也可以。背后放一盏灯看。`);
  if (p.kind === 'litho' && p.printAid && p.base !== 'onepiece') L.push(`透光浮雕 STL 已经是竖立的打印姿态：底边朝下，带 两层厚的裙边和两侧三角支脚（与浮雕隔 0.3 mm，每 8 mm 一个小连接点）。直接切片，不用再加支撑或 brim；打完撕掉裙边、掰掉支脚，用刀修平底边再插进底座。建议 0.12–0.16 mm 层高、100% 填充、外墙速度放慢，床温略高一点（PLA 60–65 °C）帮助粘牢。`);
  if (p.kind === 'litho' && p.flip) L.push(`正面凸起：两面都有起伏（背面是反向浮雕，朝灯摆放），请竖着打印（底边朝下），不需要支撑。`);
  if (p.kind === 'litho' && p.bulge > 0) L.push(`曲面透光：背面跟着正面一起鼓起 ${p.bulge} mm，厚度处处不变。推荐竖着打印（底边朝下，不需要支撑）；平放打印时背面朝下需要少量支撑。`);
  else L.push(`线条最细处约 ${((2 * cache.rMin + 1) * cache.s).toFixed(2)} mm，按 ${p.printer.d} mm 喷嘴、${p.printer.walls} 圈墙生成。`);
  L.push(`打印机设置：${p.printer.d} mm 喷嘴，${p.printer.h.toFixed(2)} mm 层高，打印范围 ${p.printer.bed.join(' × ')} mm。模型里所有高度都是层高的整数倍，切片时请用同样的层高。`);
  if (p.adjusted.length) L.push('为适配打印机自动调整：' + p.adjusted.join('；') + '。');
  if (p.text1 || p.text2) L.push('刻字较小，建议层高 0.1–0.12 mm。');
  return L.join('\r\n');
}
$('dlZip').addEventListener('click', async () => {
  if (!built) return; const p = P();
  const files = built.meshes.map(m => Object.assign({ name: m.file }, stlParts(m)));
  const enc = new TextEncoder();
  files.push({ name: p.kind === 'litho' ? 'backlit-preview.png' : 'lineart.png', data: new Uint8Array(await (await lineartPNG()).arrayBuffer()) });
  if (view.ok()) { const was = tab; if (tab !== '3d') showTab('3d'); await frame(); files.push({ name: 'preview.png', data: new Uint8Array(await (await view.snapshot()).arrayBuffer()) }); if (was !== '3d') showTab(was); }
  files.push({ name: 'print-notes.txt', data: enc.encode('﻿' + notes(p)) });
  await save('lineart-3d-model.zip', makeZip(files));
});
$('dlShot').addEventListener('click', async () => { if (!view.ok() || !built) return; const was = tab; if (tab !== '3d') showTab('3d'); await frame(); const b = await view.snapshot(); if (was !== '3d') showTab(was); await save('preview.png', b); });
$('dlLine').addEventListener('click', async () => { const li = P().kind === 'litho'; if (li ? !cache.litho : !cache.mask) return; await save(li ? 'backlit-preview.png' : 'lineart.png', await lineartPNG()); });

// ---------- boot ----------
window.addEventListener('resize', () => { if (tab === 'src') drawSrc(); if (tab === 'line') drawLine(); });
syncUI(); showTab('3d');
setSource(makeSample(), '现在显示的是示例图');
window.__app = { cache, P, get built() { return built; }, setSource, loadFile, run, invalidate, view };
})();
