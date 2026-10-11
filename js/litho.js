// ===== Faceted lithophane =====
// Thickness follows darkness (thicker = darker when back-lit). The surface is an error-driven
// adaptive triangulation: vertices are inserted where the flat facets deviate most from the
// target, so facets are small around eyes, mouth and outlines and large in smooth areas.

function lithoThickness(gray, W, H, p) {
  // analysis grid: about 6 px per vertex spacing, between 600 px and the image's own resolution
  // smooth surface: about 0.15 mm per analysis pixel and a slightly softer image, so the mesh can follow gentle shading
  // smooth detail d∈[0,1]: analysis pixel 0.2 → 0.06 mm, softening 1.2 → 0.5 px
  const d = p.smoothDetail;
  const lim = p.smooth ? Math.max(600, Math.min(3000, Math.round(p.widthMM / (0.2 * Math.pow(0.3, d))))) : Math.max(600, Math.round(Math.sqrt(p.facets) * 6));
  const k = Math.min(1, lim / Math.max(W, H)), w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
  const g = gaussBlur(gray, W, H, (p.smooth ? 1.2 - 0.7 * d : 0.6) / k), Z = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = g[Math.min(H - 1, Math.round((y + 0.5) / k - 0.5)) * W + Math.min(W - 1, Math.round((x + 0.5) / k - 0.5))];
    const dark = Math.min(1, Math.max(0, 1 - v / 255));
    Z[y * w + x] = p.tMin + (p.tMax - p.tMin) * Math.pow(dark, p.gamma);
  }
  return { Z, w, h, k };
}

// Curved lithophane: a smooth "brightness bulge" D. Back surface = D, front = D + thickness,
// so the thickness (and therefore the back-lit image) is unchanged while bright areas
// (usually the face) are lifted towards the viewer. D is zero along a flat border band
// so the frame and the edge that goes into the stand stay flat.
function lithoBulge(gray, W, H, L, p, widthMM) {
  const { w, h, k } = L, D = new Float32Array(w * h);
  if (!(p.bulge > 0)) return null;
  // heavy blur of brightness, done on a small copy for speed
  const ks = Math.min(1, 200 / Math.max(W, H)), sw = Math.max(8, Math.round(W * ks)), sh = Math.max(8, Math.round(H * ks));
  const small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) small[y * sw + x] = gray[Math.min(H - 1, Math.round((y + 0.5) / ks - 0.5)) * W + Math.min(W - 1, Math.round((x + 0.5) / ks - 0.5))];
  const b = gaussBlur(small, sw, sh, Math.max(sw, sh) / 22);
  let lo = Infinity, hi = -Infinity; for (const v of b) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const mmPerPx = widthMM / (w - 1), flat = Math.max(p.frame, p.base !== 'none' ? p.insert : 0) + 1.5;
  const ramp = Math.max(4, 0.12 * Math.min(w, h) * mmPerPx);
  const sm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) / w * sw - 0.5)), sy = Math.min(sh - 1, Math.max(0, (y + 0.5) / h * sh - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const v = (b[y0 * sw + x0] * (1 - fx) + b[y0 * sw + x1] * fx) * (1 - fy) + (b[y1 * sw + x0] * (1 - fx) + b[y1 * sw + x1] * fx) * fy;
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y) * mmPerPx;
    D[y * w + x] = p.bulge * ((v - lo) / Math.max(1, hi - lo)) * sm((edge - flat) / ramp);
  }
  return D;
}

function adaptiveTriangulation(Z, w, h, nTarget, tol, D) {
  const pts = [], used = new Uint8Array(w * h);
  const add = (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); const i = y * w + x; if (!used[i]) { used[i] = 1; pts.push(x, y); } };
  const nb = 32;
  for (let i = 0; i <= nb; i++) { add(i * (w - 1) / nb, 0); add(i * (w - 1) / nb, h - 1); add(0, i * (h - 1) / nb); add(w - 1, i * (h - 1) / nb); }
  const step = Math.max(w, h) / 10;
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) add(x, y);
  let del;
  for (let round = 0; round < 80; round++) {
    del = new d3.Delaunay(Float64Array.from(pts));
    const n = pts.length / 2; if (n >= nTarget) break;
    const T = del.triangles, nt = T.length / 3, best = new Float64Array(nt), bestPix = new Int32Array(nt).fill(-1);
    for (let t = 0; t < nt; t++) {
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1], cx = pts[2 * c], cy = pts[2 * c + 1];
      const za = Z[ay * w + ax], zb = Z[by * w + bx], zc = Z[cy * w + cx];
      const da = D ? D[ay * w + ax] : 0, db = D ? D[by * w + bx] : 0, dc = D ? D[cy * w + cx] : 0;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const i = y * w + x; if (used[i]) continue;
        let e = Math.abs(l1 * za + l2 * zb + l3 * zc - Z[i]);
        if (D) e = Math.max(e, 0.5 * Math.abs(l1 * da + l2 * db + l3 * dc - D[i]));
        if (e > best[t]) { best[t] = e; bestPix[t] = i; }
      }
    }
    const order = []; for (let t = 0; t < nt; t++) if (bestPix[t] >= 0 && best[t] > tol) order.push(t);
    if (!order.length) break;
    order.sort((u, v) => best[v] - best[u]);
    const K = Math.max(50, Math.min(Math.round(n * 0.25), nTarget - n));
    for (const t of order.slice(0, K)) { const i = bestPix[t]; if (!used[i]) { used[i] = 1; pts.push(i % w, (i / w) | 0); } }
  }
  return { pts, tris: del.triangles, hull: del.hull, Z, D, w, h };
}

// closed solid: top facets at D + thickness, back at D (flat z = 0 when there is no bulge), side walls along the hull
function lithoManifold(tri, widthMM) {
  // flip: front = K - T, back = K - 2T with K = 2·tMax. The thickness is still T everywhere (same back-lit
  // image), but the front relief is inverted: bright areas (the face) stand out, dark areas (hair) recede.
  const { pts, tris, hull, Z, D, w, h, flip, K } = tri, n = pts.length / 2, sc = widthMM / (w - 1), curved = !!(D || flip);
  const V = new Float32Array(n * 6 + (curved ? 0 : 3));
  for (let i = 0; i < n; i++) {
    const j = pts[2 * i + 1] * w + pts[2 * i], x = pts[2 * i] * sc, y = (h - 1 - pts[2 * i + 1]) * sc, d = D ? D[j] : 0;
    const top = flip ? K - Z[j] : Z[j], back = flip ? K - 2 * Z[j] : 0;
    V.set([x, y, d + top], 3 * i); V.set([x, y, d + back], 3 * (n + i));
  }
  const F = [];
  for (let t = 0; t < tris.length; t += 3) {
    let a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const cr = (V[3 * b] - V[3 * a]) * (V[3 * c + 1] - V[3 * a + 1]) - (V[3 * b + 1] - V[3 * a + 1]) * (V[3 * c] - V[3 * a]);
    if (Math.abs(cr) < 1e-12) continue;
    if (cr < 0) [b, c] = [c, b];
    F.push(a, b, c);
    if (curved) F.push(n + a, n + c, n + b);         // curved back: same triangles, reversed
  }
  const ctr = 2 * n; if (!curved) V.set([(w - 1) * sc / 2, (h - 1) * sc / 2, 0], 3 * ctr);
  let area = 0; for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; area += V[3 * a] * V[3 * b + 1] - V[3 * b] * V[3 * a + 1]; }
  for (let i = 0; i < hull.length; i++) {
    let a = hull[i], b = hull[(i + 1) % hull.length]; if (area < 0) [a, b] = [b, a];
    F.push(n + a, n + b, b, n + a, b, a);
    if (!curved) F.push(ctr, n + b, n + a);               // flat back
  }
  const mesh = G(new MF.Mesh({ numProp: 3, vertProperties: V, triVerts: Uint32Array.from(F) }));
  mesh.merge();
  return G(new MF.Manifold(mesh));
}

// smooth surface tolerance: 0.04 mm (detail 0) → 0.004 mm (detail 1)
function smoothTol(p) { return 0.04 * Math.pow(0.1, p.smoothDetail); }

// thickness of the flat slab the panel occupies (frame, edge in the stand)
function lithoDepth(p) { return p.flip ? 2 * p.tMax - p.tMin : p.tMax; }

function buildLithoPanel(gray, W, H, p, widthMM) {
  p = Object.assign({}, p, { widthMM });
  const L = lithoThickness(gray, W, H, p);
  const D = lithoBulge(gray, W, H, L, p, widthMM);
  // faceted: a fixed vertex budget; smooth: keep refining until every point is within 0.02 mm of the target
  const tri = p.smooth ? adaptiveTriangulation(L.Z, L.w, L.h, 1500000, smoothTol(p), D) : adaptiveTriangulation(L.Z, L.w, L.h, p.facets, 0.004, D); tri.widthMM = widthMM; tri.flip = !!p.flip; tri.K = 2 * p.tMax;
  let m = lithoManifold(tri, widthMM);
  const hmm = (L.h - 1) * widthMM / (L.w - 1);
  if (p.frame > 0) {
    const f = Math.min(p.frame, widthMM / 4, hmm / 4);
    const ring = G(G(rect(0, 0, widthMM, hmm).subtract(rect(f, f, widthMM - f, hmm - f))).extrude(lithoDepth(p)));
    m = G(MF.Manifold.union(m, ring));
  }
  return { panel: m, tri, hmm };
}

// what the print looks like with a light behind it
function lithoPreview(tri, p) {
  const { pts, tris, Z, w, h } = tri, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], d = tris[t + 2];
    const T = (Z[pts[2 * a + 1] * w + pts[2 * a]] + Z[pts[2 * b + 1] * w + pts[2 * b]] + Z[pts[2 * d + 1] * w + pts[2 * d]]) / 3;
    const v = Math.round(255 * Math.exp(-1.1 * (T - p.tMin)));
    x.fillStyle = `rgb(${v},${Math.round(v * 0.93)},${Math.round(v * 0.8)})`; x.strokeStyle = x.fillStyle; x.lineWidth = 0.6;
    x.beginPath(); x.moveTo(pts[2 * a], pts[2 * a + 1]); x.lineTo(pts[2 * b], pts[2 * b + 1]); x.lineTo(pts[2 * d], pts[2 * d + 1]); x.closePath(); x.fill(); x.stroke();
  }
  if (p.frame > 0) {   // the frame is at full thickness, so it shows as a dark border
    const f = p.frame / (tri.widthMM / (w - 1)); x.strokeStyle = 'rgb(%d,%d,%d)'.replace(/%d/g, () => Math.round(255 * Math.exp(-1.1 * (p.tMax - p.tMin))));
    x.lineWidth = 2 * f; x.strokeRect(0, 0, w, h);
  }
  return c;
}
