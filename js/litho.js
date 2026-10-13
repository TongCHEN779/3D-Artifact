// ===== Faceted lithophane =====
// Thickness follows darkness (thicker = darker when back-lit). The surface is an error-driven
// adaptive triangulation: vertices are inserted where the flat facets deviate most from the
// target, so facets are small around eyes, mouth and outlines and large in smooth areas.

function lithoThickness(gray, W, H, p) {
  // analysis grid: about 6 px per vertex spacing, between 600 px and the image's own resolution
  // smooth surface: about 0.15 mm per analysis pixel and a slightly softer image, so the mesh can follow gentle shading
  // smooth detail d∈[0,1]: analysis pixel 0.2 → 0.06 mm, softening 1.2 → 0.5 px
  if (p.lithoGrid) return lithoThicknessGrid(gray, W, H, p);
  const d = Number.isFinite(p.smoothDetail) ? p.smoothDetail : 0.45;
  const lim = p.lithoSmooth ? Math.max(600, Math.min(3000, Math.round(p.widthMM / (0.2 * Math.pow(0.3, d))))) : Math.max(600, Math.round(Math.sqrt(p.facets) * 6));
  const k = Math.min(1, lim / Math.max(W, H)), w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
  const g = gaussBlur(gray, W, H, (p.lithoSmooth ? 1.2 - 0.7 * d : 0.6) / k), Z = new Float32Array(w * h);
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

// Regular grid: one vertex every p.gridMM millimetres, sampled bilinearly from the photo (may go finer than
// the photo itself, which just interpolates). Capped at LITHO_MAX_VERTS vertices.
function lithoThicknessGrid(gray, W, H, p) {
  let step = Math.max(0.05, p.gridMM || 0.25);
  let w = Math.round(p.widthMM / step) + 1, h = Math.round((w - 1) * H / W) + 1;
  const cap = LITHO_MAX_VERTS; if (w * h > cap) { const f = Math.sqrt(cap / (w * h)); w = Math.max(16, Math.round(w * f)); h = Math.max(16, Math.round(h * f)); }
  const k = (w - 1) / Math.max(1, W - 1);                    // vertices per photo pixel
  const g = k < 1 ? gaussBlur(gray, W, H, 0.5 / k) : gray, Z = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(H - 1, y * (H - 1) / Math.max(1, h - 1)), y0 = Math.floor(sy), y1 = Math.min(H - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 1, x * (W - 1) / Math.max(1, w - 1)), x0 = Math.floor(sx), x1 = Math.min(W - 1, x0 + 1), fx = sx - x0;
      const v = (g[y0 * W + x0] * (1 - fx) + g[y0 * W + x1] * fx) * (1 - fy) + (g[y1 * W + x0] * (1 - fx) + g[y1 * W + x1] * fx) * fy;
      const dark = Math.min(1, Math.max(0, 1 - v / 255));
      Z[y * w + x] = p.tMin + (p.tMax - p.tMin) * Math.pow(dark, p.gamma);
    }
  }
  return { Z, w, h, k };
}
// Every grid vertex, two triangles per cell; open (boundary) edges marked -1 the way Delaunator does.
function gridTriangulation(Z, w, h, D) {
  const n = w * h, pts = new Int32Array(2 * n);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) { pts[2 * i] = x; pts[2 * i + 1] = y; }
  const nc = (w - 1) * (h - 1), tris = new Uint32Array(nc * 6), he = new Int32Array(nc * 6);
  let t = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = y * w + x, b = a + 1, c = a + w + 1, d = a + w, o = t * 3;
    tris.set([a, b, c, a, c, d], o);
    if (y === 0) he[o] = -1;              // a→b, top row
    if (x === w - 2) he[o + 1] = -1;      // b→c, right column
    if (y === h - 2) he[o + 4] = -1;      // c→d, bottom row
    if (x === 0) he[o + 5] = -1;          // d→a, left column
    t += 2;
  }
  return { pts, tris, halfedges: he, Z, D, w, h, grid: true };
}

function adaptiveTriangulation(Z, w, h, nTarget, tol, D, frameIn) {
  // points live in one preallocated typed array (no growing JS array, no per-round copies)
  const cap = Math.min(w * h, Math.max(nTarget, 0) + 4 * (w + h) + 4096), P = new Float64Array(2 * cap), used = new Uint8Array(w * h);
  let n = 0;
  const add = (x, y) => { if (n >= cap) return; x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); const i = y * w + x; if (!used[i]) { used[i] = 1; P[2 * n] = x; P[2 * n + 1] = y; n++; } };
  const nb = 32;
  for (let i = 0; i <= nb; i++) { add(i * (w - 1) / nb, 0); add(i * (w - 1) / nb, h - 1); add(0, i * (h - 1) / nb); add(w - 1, i * (h - 1) / nb); }
  if (frameIn > 0) {   // the frame's inner edge, both sides of it, so the step from frame to picture stays crisp
    for (const f of [frameIn - 1, frameIn]) {
      const x0 = f, x1 = w - 1 - f, y0 = f, y1 = h - 1 - f, sx = Math.max(2, (x1 - x0) / 120), sy = Math.max(2, (y1 - y0) / 120);
      for (let x = x0; x <= x1; x += sx) { add(x, y0); add(x, y1); }
      for (let y = y0; y <= y1; y += sy) { add(x0, y); add(x1, y); }
    }
  }
  const step = Math.max(w, h) / 10;
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) add(x, y);
  let del = null;
  for (let round = 0; round < 80; round++) {
    del = null;                                    // let the previous triangulation be collected first
    del = new d3.Delaunay(P.subarray(0, 2 * n));
    if (n >= nTarget || n >= cap) break;
    const T = del.triangles, nt = T.length / 3, best = new Float32Array(nt), bestPix = new Int32Array(nt).fill(-1);
    for (let t = 0; t < nt; t++) {
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const ax = P[2 * a], ay = P[2 * a + 1], bx = P[2 * b], by = P[2 * b + 1], cx = P[2 * c], cy = P[2 * c + 1];
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
    // bigger batches once the mesh is large: fewer rounds, fewer full re-triangulations
    const K = Math.max(50, Math.min(Math.round(n * (n > 50000 ? 0.5 : 0.25)), nTarget - n));
    for (let j = 0; j < order.length && j < K; j++) { const i = bestPix[order[j]]; if (!used[i]) add(i % w, (i / w) | 0); }
  }
  const pts = new Int32Array(2 * n); for (let i = 0; i < 2 * n; i++) pts[i] = P[i];
  return { pts, tris: del.triangles, halfedges: del.halfedges, Z, D, w, h };
}

// closed solid: top facets at D + thickness, back at D (z = 0 when flat), side walls along the open edges
function lithoManifold(tri, widthMM) {
  // flip: front = K - T, back = K - 2T with K = 2·tMax. The thickness is still T everywhere (same back-lit
  // image), but the front relief is inverted: bright areas (the face) stand out, dark areas (hair) recede.
  // The frame is part of this one mesh (vertices in the frame band sit at the full slab, 0 … depth), so no
  // boolean union with a separate ring is needed — unions on multi-million-triangle meshes are what ran out of memory.
  const { pts, tris, halfedges, Z, D, w, h, flip, K, framePx = 0, depth = 0 } = tri, n = pts.length / 2, sc = widthMM / (w - 1);
  const curved = !!(D || flip), nOpen = countOpen(halfedges);
  const nv = curved ? 2 * n : 2 * n + 1;          // flat back: one extra centre vertex for a fan
  const V = new Float32Array(nv * 3);
  for (let i = 0; i < n; i++) {
    const px = pts[2 * i], py = pts[2 * i + 1], j = py * w + px, x = px * sc, y = (h - 1 - py) * sc;
    const inFrame = framePx > 0 && (px < framePx || py < framePx || px > w - 1 - framePx || py > h - 1 - framePx);
    let top, back, d = D ? D[j] : 0;
    if (inFrame) { top = depth; back = 0; d = 0; }
    else { top = flip ? K - Z[j] : Z[j]; back = flip ? K - 2 * Z[j] : 0; }
    V[3 * i] = x; V[3 * i + 1] = y; V[3 * i + 2] = d + top;
    V[3 * (n + i)] = x; V[3 * (n + i) + 1] = y; V[3 * (n + i) + 2] = curved ? d + back : 0;
  }
  // Orientation is decided on the exact integer pixel coordinates (y points down there, so the sign flips).
  const F = new Uint32Array(tris.length * (curved ? 2 : 1) + 6 * nOpen + (curved ? 0 : 3 * nOpen)); let o = 0;
  const flipped = new Uint8Array(tris.length / 3);
  for (let t = 0; t < tris.length; t += 3) {
    let a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const crPix = (pts[2 * b] - pts[2 * a]) * (pts[2 * c + 1] - pts[2 * a + 1]) - (pts[2 * b + 1] - pts[2 * a + 1]) * (pts[2 * c] - pts[2 * a]);
    if (crPix > 0) { [b, c] = [c, b]; flipped[t / 3] = 1; }    // want counter-clockwise in mm (y up)
    F[o++] = a; F[o++] = b; F[o++] = c;
    if (curved) { F[o++] = n + a; F[o++] = n + c; F[o++] = n + b; }   // curved back: same triangles, reversed
  }
  // A flat back only needs a fan from a centre point to the outline (the outline of a rectangle is star-shaped
  // from its centre) — half the triangles of mirroring the top. The centre is nudged off the pixel grid so it
  // never coincides with another vertex.
  const ctr = 2 * n;
  if (!curved) { V[3 * ctr] = ((w - 1) / 2 + 0.37) * sc; V[3 * ctr + 1] = ((h - 1) / 2 + 0.29) * sc; V[3 * ctr + 2] = 0; }
  // side walls on every edge that belongs to only one triangle
  for (let e = 0; e < halfedges.length; e++) {
    if (halfedges[e] !== -1) continue;
    const t = (e / 3) | 0, e2 = e % 3 === 2 ? e - 2 : e + 1;
    let a = tris[e], b = tris[e2]; if (flipped[t]) [a, b] = [b, a];   // a → b as it runs in the top face
    F[o++] = b; F[o++] = a; F[o++] = n + a;
    F[o++] = b; F[o++] = n + a; F[o++] = n + b;
    if (!curved) { F[o++] = ctr; F[o++] = n + b; F[o++] = n + a; }
  }
  const mesh = new MF.Mesh({ numProp: 3, vertProperties: V, triVerts: F });
  try { return G(new MF.Manifold(mesh)); }
  catch (e) {
    try { mesh.merge(); return G(new MF.Manifold(mesh)); }
    catch (e2) {
      let bad = 0; for (let i = 0; i < V.length; i++) if (!Number.isFinite(V[i])) bad++;
      const msg = String(e2 && e2.message || e2);
      throw new Error(/memory|bounds|alloc/i.test(msg) ? '内存不足：网格太大（' + (F.length / 3 / 1e6).toFixed(1) + ' 百万三角面），请降低细度/精度或加大网格间距'
        : `Not manifold（透光浮雕网格：${n} 点，${tris.length / 3} 三角面，${nOpen} 条外边，${bad} 个无效坐标，图 ${w}×${h}）`);
    }
  }

}
function countOpen(he) { let k = 0; for (let i = 0; i < he.length; i++) if (he[i] === -1) k++; return k; }

// smooth surface tolerance: 0.04 mm (detail 0) → 0.004 mm (detail 1)
function smoothTol(p) { return 0.04 * Math.pow(0.1, Number.isFinite(p.smoothDetail) ? p.smoothDetail : 0.45); }

// thickness of the flat slab the panel occupies (frame, edge in the stand)
function lithoDepth(p) { return p.flip ? 2 * p.tMax - p.tMin : p.tMax; }   // stepped levels are rounded to layers, within a layer of this

// ===== Stepped lithophane (printable lines) =====
// Thickness is quantised into a few levels. Each level is a flat terrace with vertical walls, every terrace
// and every gap at least one printable line wide (from the printer settings), and every height a whole
// number of layers — so ridges come out as real walls instead of the sharp-topped, wide-footed ridges a
// smooth height map makes. Built from 2D outlines extruded per level, like the cut-out and plaque models.
function buildSteppedPanel(gray, W, H, p, widthMM) {
  const pr = p.printer || { h: 0.2, minLine: 0.84, minGap: 0.4 };
  const px = Math.max(0.05, Math.min(0.15, pr.minLine / 6));          // analysis pixel (mm)
  const w = Math.max(16, Math.round(widthMM / px) + 1), h = Math.max(16, Math.round((w - 1) * H / W) + 1), sc = widthMM / (w - 1);
  const k = (w - 1) / Math.max(1, W - 1), g = k < 1 ? gaussBlur(gray, W, H, 0.5 / k) : gray;
  const N = Math.max(2, Math.min(Math.round(p.levels || 8), Math.round((p.tMax - p.tMin) / pr.h) + 1));   // no more levels than layers
  // level thicknesses, whole layers, strictly increasing
  const T = []; for (let i = 0; i < N; i++) { const t = p.tMin + (p.tMax - p.tMin) * i / (N - 1); T.push(Math.max(2 * pr.h, Math.round(t / pr.h) * pr.h)); }
  for (let i = 1; i < N; i++) if (T[i] <= T[i - 1] + 1e-6) T[i] = T[i - 1] + pr.h;
  // darkness → level index
  const lev = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(H - 1, y * (H - 1) / Math.max(1, h - 1)), y0 = Math.floor(sy), y1 = Math.min(H - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 1, x * (W - 1) / Math.max(1, w - 1)), x0 = Math.floor(sx), x1 = Math.min(W - 1, x0 + 1), fx = sx - x0;
      const v = (g[y0 * W + x0] * (1 - fx) + g[y0 * W + x1] * fx) * (1 - fy) + (g[y1 * W + x0] * (1 - fx) + g[y1 * W + x1] * fx) * fy;
      const dark = Math.pow(Math.min(1, Math.max(0, 1 - v / 255)), p.gamma);
      lev[y * w + x] = Math.min(N - 1, Math.round(dark * (N - 1)));
    }
  }
  const framePx = p.frame > 0 ? Math.round(Math.min(p.frame, widthMM / 4, (h - 1) * sc / 4) / sc) : 0;
  // cumulative masks (level ≥ i), cleaned so every raised part and every gap is printable, and kept nested
  const rLine = Math.max(1, Math.round(pr.minLine / 2 / sc)), rGap = Math.max(1, Math.round(pr.minGap / 2 / sc));
  const masks = [null]; let prev = null;
  for (let i = 1; i < N; i++) {
    let m = new Uint8Array(w * h); for (let j = 0; j < m.length; j++) m[j] = lev[j] >= i ? 1 : 0;
    m = dilate(erode(m, w, h, rLine), w, h, rLine);                  // drop parts thinner than one printable line
    m = erode(dilate(m, w, h, rGap), w, h, rGap);                    // close gaps narrower than the nozzle
    if (prev) for (let j = 0; j < m.length; j++) m[j] &= prev[j];
    masks.push(m); prev = m;
  }
  // per-pixel final level (for the back-lit preview), frame at full thickness
  const Zq = new Float32Array(w * h);
  for (let j = 0; j < Zq.length; j++) { let L = 0; for (let i = N - 1; i >= 1; i--) if (masks[i][j]) { L = i; break; } Zq[j] = T[L]; }
  // geometry: each exact level region is a slab with vertical sides
  //   normal: 0 … T_i      face forward (flip): K − 2·T_i … K − T_i  (same thickness, inverted front relief)
  const K = 2 * T[N - 1], depth = p.flip ? K - T[0] : T[N - 1], solids = [];
  const sm = Math.max(0.6, 0.04 / sc), Wm = (w - 1) * sc, Hm = (h - 1) * sc, PAD = 3;
  const frameRect = rect(0, 0, Wm, Hm);
  // smooth outline of a mask; the mask is padded by repeating its edge so outlines run past the panel border,
  // then clipped to the panel — no hairline strips along the edges
  const outline = m => {
    const pw = w + 2 * PAD, ph = h + 2 * PAD, q = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++) { const sy = Math.min(h - 1, Math.max(0, y - PAD)); for (let x = 0; x < pw; x++) q[y * pw + x] = m[sy * w + Math.min(w - 1, Math.max(0, x - PAD))]; }
    const f = gaussBlur(q, pw, ph, sm), cs = fieldToCrossSection(f, pw, ph, sc);
    return cs ? G(G(cs.translate([-PAD * sc, -PAD * sc])).intersect(frameRect)) : null;
  };
  if (!p.flip) {
    // terraces stacked from the back: base plate 0…T₀, then every "level ≥ i" area extruded 0…Tᵢ
    solids.push(G(frameRect.extrude(T[0])));
    for (let i = 1; i < N; i++) { const cs = outline(masks[i]); if (cs && cs.area() > 0) solids.push(G(cs.extrude(T[i]))); }
  } else {
    // face forward: front Fᵢ = K − Tᵢ, back Bᵢ = K − 2Tᵢ (thickness Tᵢ, front relief inverted).
    // Both fall as the level rises, so with Lᵢ = "level ≤ i":  solid = ⋃ Lᵢ×[0, Fᵢ]  minus  ⋃ Lᵢ×[−1, Bᵢ].
    // Each Lᵢ outline is used for both, so the front and back steps line up exactly.
    const add = [G(frameRect.extrude(K - T[N - 1]))], cut = [];
    for (let i = 0; i < N - 1; i++) {
      const comp = new Uint8Array(w * h); for (let j = 0; j < comp.length; j++) comp[j] = masks[i + 1][j] ? 0 : 1;
      const cs = outline(comp); if (!cs || !(cs.area() > 0)) continue;
      add.push(G(cs.extrude(K - T[i])));
      cut.push(G(G(cs.extrude(K - 2 * T[i] + 1)).translate([0, 0, -1])));
    }
    solids.push(G(G(MF.Manifold.union(add)).subtract(G(MF.Manifold.union(cut)))));
  }
  let m = G(MF.Manifold.union(solids));
  if (framePx > 0) {
    const f = framePx * sc;
    const ring = G(G(rect(0, 0, Wm, Hm).subtract(rect(f, f, Wm - f, Hm - f))).extrude(depth));
    m = G(MF.Manifold.union(m, ring));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < framePx || y < framePx || x > w - 1 - framePx || y > h - 1 - framePx) Zq[y * w + x] = T[N - 1];
  }
  const tri = { grid: true, stepped: true, levels: N, T, Z: Zq, w, h, widthMM, pts: [], tris: [] };
  return { panel: m, tri, hmm: (h - 1) * sc };
}

// Edge-preserving denoise (self-guided filter, He et al. 2010). Flat areas — a plain background, skin — have
// 8-bit banding and sensor noise of a gray level or two; a fine mesh would trace those as tiny random facets
// (a "frosted" look, millions of useless triangles, all far below what a printer can make). The guided filter
// flattens variations smaller than σ (in gray levels) inside a window of radius r, but keeps real edges.
function boxMean(a, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {                       // horizontal running sum
    let s = 0; const o = y * W;
    for (let x = -r; x <= r; x++) s += a[o + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) { tmp[o + x] = s; s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
  }
  const n = (2 * r + 1) * (2 * r + 1);
  for (let x = 0; x < W; x++) {                       // vertical running sum
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = s / n; s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
  }
  return out;
}
function guidedDenoise(I, W, H, r, sigma) {
  if (!(sigma > 0) || r < 1) return I;
  const eps = sigma * sigma, n = W * H, II = new Float32Array(n);
  for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
  const mI = boxMean(I, W, H, r), mII = boxMean(II, W, H, r), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.max(0, mII[i] - mI[i] * mI[i]), a = v / (v + eps); A[i] = a; B[i] = mI[i] - a * mI[i]; }
  const mA = boxMean(A, W, H, r), mB = boxMean(B, W, H, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = mA[i] * I[i] + mB[i];
  return q;
}

function buildLithoPanel(gray, W, H, p, widthMM) {
  p = Object.assign({}, p, { widthMM });
  if (p.denoise > 0) {   // σ up to 8 gray levels, window about 0.6 mm
    const r = Math.max(2, Math.min(20, Math.round(0.6 / (widthMM / W))));
    gray = guidedDenoise(Float32Array.from(gray), W, H, r, 8 * p.denoise / 100);
  }
  if (p.lithoStep) return buildSteppedPanel(gray, W, H, p, widthMM);
  const L = lithoThickness(gray, W, H, p);
  const D = lithoBulge(gray, W, H, L, p, widthMM);
  const sc = widthMM / (L.w - 1), hmm = (L.h - 1) * sc;
  const framePx = p.frame > 0 ? Math.round(Math.min(p.frame, widthMM / 4, hmm / 4) / sc) : 0;
  if (framePx > 0) {   // the frame reads as full thickness everywhere — refinement then puts points along its edge
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++)
      if (x < framePx || y < framePx || x > L.w - 1 - framePx || y > L.h - 1 - framePx) L.Z[y * L.w + x] = p.tMax;
  }
  // faceted: a fixed vertex budget; smooth: refine until within tolerance; grid: every vertex
  const tri = p.lithoGrid ? gridTriangulation(L.Z, L.w, L.h, D)
    : p.lithoSmooth ? adaptiveTriangulation(L.Z, L.w, L.h, LITHO_MAX_VERTS, smoothTol(p), D, framePx) : adaptiveTriangulation(L.Z, L.w, L.h, Math.min(p.facets, LITHO_MAX_VERTS), 0.004, D, framePx);
  Object.assign(tri, { widthMM, flip: !!p.flip, K: 2 * p.tMax, framePx, depth: lithoDepth(p) });
  const m = lithoManifold(tri, widthMM);
  return { panel: m, tri, hmm };
}
// The browser gives WebAssembly at most 4 GB, and the geometry kernel needs a few hundred bytes per triangle,
// so keep the lithophane under about two million vertices (4–8 million triangles with walls and back).
const LITHO_MAX_VERTS = 1600000;

// what the print looks like with a light behind it
function lithoPreview(tri, p) {
  const { pts, tris, Z, w, h } = tri, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (tri.grid) {   // one vertex per pixel: write the pixels directly
    const im = x.createImageData(w, h), D = im.data;
    for (let i = 0; i < w * h; i++) { const v = 255 * Math.exp(-1.1 * (Z[i] - p.tMin)); D[4 * i] = v; D[4 * i + 1] = v * 0.93; D[4 * i + 2] = v * 0.8; D[4 * i + 3] = 255; }
    x.putImageData(im, 0, 0);
  } else {
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], d = tris[t + 2];
    const T = (Z[pts[2 * a + 1] * w + pts[2 * a]] + Z[pts[2 * b + 1] * w + pts[2 * b]] + Z[pts[2 * d + 1] * w + pts[2 * d]]) / 3;
    const v = Math.round(255 * Math.exp(-1.1 * (T - p.tMin)));
    x.fillStyle = `rgb(${v},${Math.round(v * 0.93)},${Math.round(v * 0.8)})`; x.strokeStyle = x.fillStyle; x.lineWidth = 0.6;
    x.beginPath(); x.moveTo(pts[2 * a], pts[2 * a + 1]); x.lineTo(pts[2 * b], pts[2 * b + 1]); x.lineTo(pts[2 * d], pts[2 * d + 1]); x.closePath(); x.fill(); x.stroke();
  }
  }
  if (p.frame > 0) {   // the frame is at full thickness, so it shows as a dark border
    const f = p.frame / (tri.widthMM / (w - 1)); x.strokeStyle = 'rgb(%d,%d,%d)'.replace(/%d/g, () => Math.round(255 * Math.exp(-1.1 * (p.tMax - p.tMin))));
    x.lineWidth = 2 * f; x.strokeRect(0, 0, w, h);
  }
  return c;
}
