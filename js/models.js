// ===== 3D: contours → CrossSection → Manifold models, text, STL, ZIP =====
let MF = null; // manifold wasm namespace
async function initManifold() {
  if (MF) return MF;
  const { default: Module } = await import(new URL('vendor/manifold/manifold.js', document.baseURI).href);
  MF = await Module();
  MF.setup();
  return MF;
}
let garbage = [];
const G = o => { garbage.push(o); return o; };
function collectGarbage() { for (const o of garbage) { try { o.delete(); } catch (e) {} } garbage = []; }

// field (row-major W×H, values 0..1) → CrossSection in mm, y up
function fieldToCrossSection(field, W, H, s) {
  const mp = d3.contours().size([W, H]).thresholds([0.5])(field)[0];
  const rings = [];
  for (const poly of mp.coordinates) for (const ring of poly) {
    const r = ring.slice(0, -1).map(([x, y]) => [x * s, (H - y) * s]);
    if (r.length >= 3) rings.push(r);
  }
  if (!rings.length) return null;
  return G(G(new MF.CrossSection(rings, 'EvenOdd')).simplify(0.01));
}

// ---- text ----
function textCrossSection(str, font, heightMM, minStroke = 0) {
  if (!str || !font) return null;
  const path = font.getPath(str, 0, 0, 100);
  const rings = []; let cur = null, lx = 0, ly = 0;
  const push = (x, y) => { cur.push([x, -y]); lx = x; ly = y; };
  for (const c of path.commands) {
    if (c.type === 'M') { cur = []; rings.push(cur); push(c.x, c.y); }
    else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q') { const x0 = lx, y0 = ly; for (let t = 1; t <= 6; t++) { const u = t / 6, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u; push(a * x0 + b * c.x1 + d * c.x, a * y0 + b * c.y1 + d * c.y); } }
    else if (c.type === 'C') { const x0 = lx, y0 = ly; for (let t = 1; t <= 8; t++) { const u = t / 8, v = 1 - u; push(v*v*v*x0 + 3*v*v*u*c.x1 + 3*v*u*u*c.x2 + u*u*u*c.x, v*v*v*y0 + 3*v*v*u*c.y1 + 3*v*u*u*c.y2 + u*u*u*c.y); } }
  }
  const good = rings.filter(r => r.length >= 3);
  if (!good.length) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const r of good) for (const [x, y] of r) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const k = heightMM / (maxy - miny), cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const scaled = good.map(r => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k]));
  let cs = G(new MF.CrossSection(scaled, 'NonZero'));
  // average stroke width ≈ 2·area / outline length; embolden thin fonts so strokes are at least one extrusion wide
  if (minStroke > 0) {
    let per = 0; for (const r of scaled) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const sw = 2 * cs.area() / Math.max(per, 1e-6);
    if (sw < minStroke) cs = G(cs.offset((minStroke - sw) / 2, 'Round'));
  }
  return { cs, w: (maxx - minx) * k, h: heightMM };
}

function rect(x0, y0, x1, y1) { return G(new MF.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], 'Positive')); }
function box(cx, cy, z0, sx, sy, sz) { return G(G(MF.Manifold.cube([sx, sy, sz], false)).translate([cx - sx / 2, cy - sy / 2, z0])); }

// Build everything. Returns {parts:[{name,file,manifold,role}], warnings, dims}
function buildModels(art, p, fonts, litho) {
  const { Manifold } = MF;
  const warnings = [];
  const font = fonts[p.font];
  const standing = p.base !== 'none';
  let panel, panelT;

  if (p.kind === 'litho') {
    panel = litho; panelT = Math.max(lithoDepth(p), 0.1);
  } else {
    panel = G(art.extrude(p.thick));
    panelT = p.thick;
  }

  // lithophane printed on its own: optionally stand it upright with a peel-off brim and two snap-off side fins
  const lithoPrint = p.kind === 'litho' && p.printAid ? lithoPrintAids(panel, p, warnings) : null;
  if (!standing) {
    if (lithoPrint) return { parts: [Object.assign({ name: PANEL_NAME[p.kind] + '（竖打，含支脚）', file: PANEL_FILE[p.kind], role: 'panel' }, lithoPrint)], warnings, dims: partDims(lithoPrint) };
    return { parts: [{ name: PANEL_NAME[p.kind], file: PANEL_FILE[p.kind], manifold: panel, role: 'panel', flat: true }], warnings, dims: dimsOf(panel) };
  }

  // ---- standing on a long base ----
  const pb = panel.boundingBox();
  const pw = pb.max[0] - pb.min[0];
  const L = pw + 2 * p.overhang, D = Math.max(p.baseD, panelT + 4), H = p.baseH;
  const stepH = p.step ? Math.min(1.5, H * 0.3) : 0, BT = H + stepH;
  let insert = Math.min(p.insert, BT - 1.5);
  if (insert < p.insert) warnings.push(`底座太薄，插入深度已缩为 ${insert.toFixed(1)} mm。`);
  let base = box(0, 0, 0, L, D, H);
  if (stepH) base = G(Manifold.union(base, box(0, 0, H, L - 6, Math.max(D - 6, panelT + 2), stepH)));

  const th = Math.min(p.textH, H - 0.8);
  if (p.textH > H - 0.8 && (p.text1 || p.text2)) warnings.push(`底座侧面只有 ${H} mm 高，字高已缩为 ${th.toFixed(1)} mm。`);
  for (const [str, back] of [[p.text1, false], [p.text2, true]]) {
    const t = textCrossSection(str, font, th, p.printer ? p.printer.minStroke : 0);
    if (!t) continue;
    if (t.w > L - 4) warnings.push(`“${str}” 比底座长，建议缩小字高或缩短文字。`);
    let cut = G(G(t.cs.extrude(2 * p.textD, 0, 0, [1, 1], true)).rotate([90, 0, back ? 180 : 0]));
    cut = G(cut.translate([0, back ? D / 2 : -D / 2, H / 2]));
    base = G(base.subtract(cut));
  }

  // stand the panel in the slot: rotate about x, centre the flat 0..panelT slab (not the bounding box) over the
  // slot so a curved lithophane's bulge doesn't shift it. Big panels keep this as a matrix (no copy).
  const placedM = RX90(-(pb.min[0] + pb.max[0]) / 2, panelT / 2, BT - insert - pb.min[1]);
  const big = panel.numTri() > BIG_TRIS;
  const placed = big ? null : G(G(panel.rotate([90, 0, 0])).translate([placedM[3], placedM[7], placedM[11]]));
  const placedPiece = big ? { m: panel, M: placedM } : { m: placed, M: null };

  if (p.base === 'onepiece') {
    const view = [{ m: base, role: 'base' }, Object.assign({ role: 'panel' }, placedPiece)];
    if (big) { bigNote(warnings, panel.numTri()); const pt = { pieces: [{ m: base, M: null }, placedPiece] }; return { parts: [{ name: '一体式摆件', file: 'stand_onepiece.stl', pieces: pt.pieces, role: 'combo', view }], warnings, dims: partDims(pt) }; }
    const one = G(Manifold.union(base, placed));
    return { parts: [{ name: '一体式摆件', file: 'stand_onepiece.stl', manifold: one, role: 'combo', view }], warnings, dims: dimsOf(one) };
  }
  const c = p.clearance, sd = insert + 0.5;
  const slot = box(0, 0, BT - sd, pw + 2 * c, panelT + 2 * c, sd + 2);
  const slotted = G(base.subtract(slot));
  return {
    parts: [
      Object.assign({ name: PANEL_NAME[p.kind] + (p.kind === 'litho' ? (lithoPrint ? '（竖打，含支脚）' : '') : '（平放打印）'), file: PANEL_FILE[p.kind], role: 'panel', flat: true, view: [Object.assign({ role: 'panel' }, placedPiece)] }, lithoPrint || { manifold: panel }),
      { name: '卡槽底座', file: 'base_with_slot.stl', manifold: slotted, role: 'base' },
    ],
    warnings, dims: partDims({ pieces: [{ m: slotted, M: null }, placedPiece] }),
    slot: { w: pw + 2 * c, t: panelT + 2 * c, depth: sd },
  };
}
// ---- parts made of pieces --------------------------------------------------------------------------
// A part is either { manifold } or { pieces: [{ m, M }] } where M is a 3×4 row-major transform applied only
// when the STL is written or the viewer draws it. Rotating or moving a multi-million-triangle manifold makes a
// full copy inside the geometry kernel; keeping the matrix aside avoids those copies.
const RX90 = (tx, ty, tz) => [1, 0, 0, tx, 0, 0, -1, ty, 0, 1, 0, tz];      // rotate +90° about x, then move
function bboxM(m, M) {
  const b = m.boundingBox(); if (!M) return b;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]])
    for (let r = 0; r < 3; r++) { const v = M[4 * r] * x + M[4 * r + 1] * y + M[4 * r + 2] * z + M[4 * r + 3]; lo[r] = Math.min(lo[r], v); hi[r] = Math.max(hi[r], v); }
  return { min: lo, max: hi };
}
function piecesOf(pt) { return pt.pieces || [{ m: pt.manifold || pt, M: null }]; }
function partBBox(pt) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of piecesOf(pt)) { const b = bboxM(q.m, q.M); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.min[i]); hi[i] = Math.max(hi[i], b.max[i]); } }
  return { min: lo, max: hi };
}
function partDims(pt) { const b = partBBox(pt); return [0, 1, 2].map(i => b.max[i] - b.min[i]); }
function partTris(pt) { return piecesOf(pt).reduce((a, q) => a + q.m.numTri(), 0); }

// Boolean union is exact but needs several copies of the geometry in memory. For very large meshes
// (high-detail lithophanes) the overlapping solids are packed into one file instead; every slicer merges
// overlapping shells of one object when it slices, so the print is the same.
const BIG_TRIS = 500000;
function bigNote(warnings, nt) {
  if (warnings && !warnings.joined) { warnings.joined = true; warnings.push(`模型很大（${(nt / 1e6).toFixed(1)} 百万三角面），为节省内存，重叠的部件（支脚、底座）没有做布尔合并，而是作为几个相互穿插的壳体放在同一个 STL 里——切片软件会自动合并，打印结果一样。`); }
}

// Print aids for a lithophane standing on its bottom edge (the usual way to print one):
//  · a 0.4 mm brim (two layers) under and around the bottom edge, for adhesion — peel it off after printing;
//  · a triangular fin on each side, 0.3 mm away from the panel and joined to it by small tabs every 8 mm,
//    so the tall thin plate can't wobble or tip over — snap the fins off after printing.
// The result is returned standing, bottom edge on z = 0, ready for the slicer.
function lithoPrintAids(panel, p, warnings) {
  const { Manifold } = MF;
  const b = panel.boundingBox(), x0 = b.min[0], x1 = b.max[0], y0 = b.min[1], Hp = b.max[1] - b.min[1];
  const T = lithoDepth(p), F = Math.max(12, Math.min(25, Hp * 0.18)), Hf = Math.min(Hp * 0.6, 70);
  const pr = p.printer || { h: 0.2, lineW: 0.42 }, gap = Math.max(0.3, pr.h * 1.5), ft = Math.max(1.6, 3 * pr.lineW), brimH = 2 * pr.h, brimOut = 6, tabW = Math.max(1, 2 * pr.lineW);
  const cub = (ax, ay, az, bx, by, bz) => G(G(Manifold.cube([bx - ax, by - ay, bz - az])).translate([ax, ay, az]));
  const aids = [cub(x0 - gap - ft - brimOut, y0, -F - 4, x1 + gap + ft + brimOut, y0 + brimH, T + F + 4)];
  for (const side of [-1, 1]) {
    const xa = side < 0 ? x0 - gap - ft : x1 + gap, xb = xa + ft, pts = [];
    for (const x of [xa, xb]) pts.push([x, y0, -F], [x, y0, T + F], [x, y0 + Hf, 0], [x, y0 + Hf, T]);
    aids.push(G(Manifold.hull(pts)));
    // tabs bridge the gap; they reach 0.3 mm into the panel's (flat) side edge
    const ta = side < 0 ? xb - 0.05 : x1 - 0.3, tb = side < 0 ? x0 + 0.3 : xa + 0.05;
    for (let y = y0 + 3; y < y0 + Hf - 2; y += 8) aids.push(cub(ta, y, 0.4, tb, y + tabW, Math.max(0.8, T - 0.4)));
  }
  const aid = G(Manifold.union(aids));           // small: brim, fins and tabs only
  // stand it up: rotate about x, centre on x/y, bottom on z = 0
  const bb = partBBox({ pieces: [{ m: panel, M: RX90(0, 0, 0) }, { m: aid, M: RX90(0, 0, 0) }] });
  const M = RX90(-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]);
  if (panel.numTri() <= BIG_TRIS) {
    let u = G(Manifold.union(panel, aid)); u = G(u.rotate([90, 0, 0]));
    return { manifold: G(u.translate([M[3], M[7], M[11]])) };
  }
  bigNote(warnings, panel.numTri());
  return { pieces: [{ m: panel, M }, { m: aid, M }] };
}
const PANEL_NAME = { cutout: '镂空剪影', litho: '透光浮雕' };
const PANEL_FILE = { cutout: 'cutout.stl', litho: 'lithophane.stl' };
function dimsOf(m) { const b = m.boundingBox(); return [0, 1, 2].map(i => b.max[i] - b.min[i]); }

function meshArrays(m) {
  const mesh = m.getMesh(), np = mesh.numProp, vp = mesh.vertProperties;
  let pos = vp;
  if (np !== 3) { const nv = vp.length / np; pos = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) { pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2]; } }
  return { pos, idx: mesh.triVerts };
}
// Binary STL written in chunks of at most 1 M triangles (50 MB), returned as a list of pieces plus their CRC,
// so a 6-million-triangle model never needs one 300 MB buffer (the ZIP and the download take the pieces as is).
function stlParts(part) {
  const pcs = piecesOf(part), CH = 1000000, parts = [];
  const nt = pcs.reduce((a, q) => a + q.m.numTri(), 0);
  const head = new Uint8Array(84), hd = new DataView(head.buffer);
  const hdr = 'Line-art 3D print model'; for (let i = 0; i < hdr.length; i++) head[i] = hdr.charCodeAt(i);
  hd.setUint32(80, nt, true); parts.push(head);
  let crc = crcUpdate(0xFFFFFFFF, head);
  for (const q of pcs) {
  let { pos, idx } = meshArrays(q.m); const qt = idx.length / 3, M = q.M;
  if (M) { const P = new Float32Array(pos.length); for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; P[i] = M[0] * x + M[1] * y + M[2] * z + M[3]; P[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; P[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11]; } pos = P; }
  for (let t0 = 0; t0 < qt; t0 += CH) {
    const n = Math.min(CH, qt - t0), buf = new ArrayBuffer(n * 50), dv = new DataView(buf); let o = 0;
    for (let t = t0; t < t0 + n; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (const v of [a, b, c]) { dv.setFloat32(o, pos[v], true); dv.setFloat32(o + 4, pos[v + 1], true); dv.setFloat32(o + 8, pos[v + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    const u = new Uint8Array(buf); crc = crcUpdate(crc, u); parts.push(u);
  }
  }
  return { parts, size: 84 + nt * 50, crc: (crc ^ 0xFFFFFFFF) >>> 0 };
}
function stlBinary(part) { const { parts, size } = stlParts(part), out = new Uint8Array(size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crcUpdate(c, d) { for (let i = 0; i < d.length; i++) c = CRC_T[(c ^ d[i]) & 255] ^ (c >>> 8); return c; }
function crc32(d) { return (crcUpdate(0xFFFFFFFF, d) ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), chunks = [], central = []; let off = 0;
  for (const f of files) {
    // f.data: one Uint8Array, or f.parts + f.size + f.crc for data already split into pieces
    const name = enc.encode(f.name), pieces = f.parts || [f.data], size = f.parts ? f.size : f.data.length, crc = f.parts ? f.crc : crc32(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, size, true);
    h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), name, ...pieces);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + size;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
