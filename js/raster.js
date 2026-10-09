// ===== Raster toolkit: distance transform, morphology, labeling, thinning =====
const INF = 1e20;

// Exact squared Euclidean distance transform (Felzenszwalb) with nearest-feature index.
function edt(feature, W, H) {
  const N = W * H;
  const d1 = new Float64Array(N), i1 = new Int32Array(N);
  const d2 = new Float32Array(N), i2 = new Int32Array(N);
  const n = Math.max(W, H);
  const f = new Float64Array(n), src = new Int32Array(n), d = new Float64Array(n), arg = new Int32Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  function pass(len) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
      arg[q] = src[v[k]];
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { const p = y * W + x; f[y] = feature[p] ? 0 : INF; src[y] = p; }
    pass(H);
    for (let y = 0; y < H; y++) { const p = y * W + x; d1[p] = d[y]; i1[p] = arg[y]; }
  }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) { f[x] = d1[o + x]; src[x] = i1[o + x]; }
    pass(W);
    for (let x = 0; x < W; x++) { d2[o + x] = d[x]; i2[o + x] = arg[x]; }
  }
  return { d2, idx: i2 };
}

function dilate(m, W, H, r) {
  if (r <= 0) return m.slice();
  const { d2 } = edt(m, W, H), out = new Uint8Array(W * H), rr = r * r + 0.01;
  for (let i = 0; i < out.length; i++) out[i] = d2[i] <= rr ? 1 : 0;
  return out;
}
function erode(m, W, H, r) {
  if (r <= 0) return m.slice();
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  // like OpenCV: the area outside the image does not erode
  const { d2 } = edt(inv, W, H), out = new Uint8Array(W * H), rr = r * r + 0.01;
  for (let i = 0; i < out.length; i++) out[i] = (m[i] && d2[i] > rr) ? 1 : 0;
  return out;
}
const opening = (m, W, H, r) => dilate(erode(m, W, H, r), W, H, r);
const closing = (m, W, H, r) => erode(dilate(m, W, H, r), W, H, r);

// 8-connected component labeling
function label(m, W, H) {
  const lab = new Int32Array(W * H), areas = [0], stack = new Int32Array(W * H);
  let n = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    n++; let sp = 0, area = 0; stack[sp++] = s; lab[s] = n;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx;
          if (m[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        }
      }
    }
    areas.push(area);
  }
  return { lab, n, areas };
}

function gaussBlur(src, W, H, sigma) {
  if (sigma <= 0.05) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const o = y * W;
    for (let x = 0; x < W; x++) { let a = 0;
      for (let i = -r; i <= r; i++) { let xx = x + i; xx = xx < 0 ? 0 : xx >= W ? W - 1 : xx; a += src[o + xx] * k[i + r]; }
      tmp[o + x] = a; } }
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) { let a = 0;
      for (let i = -r; i <= r; i++) { let yy = y + i; yy = yy < 0 ? 0 : yy >= H ? H - 1 : yy; a += tmp[yy * W + x] * k[i + r]; }
      out[y * W + x] = a; }
  return out;
}

function otsu(gray) {
  const h = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) h[Math.max(0, Math.min(255, gray[i] | 0))]++;
  const N = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += h[t]; if (!wB) continue; const wF = N - wB; if (!wF) break;
    sB += t * h[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

function adaptiveMask(gray, W, H, block, C) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0;
    for (let x = 0; x < W; x++) { row += gray[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const r = Math.max(1, block >> 1), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    const mean = s / ((x1 - x0) * (y1 - y0));
    out[y * W + x] = gray[y * W + x] < mean - C ? 1 : 0;
  }
  return out;
}

// Zhang–Suen thinning
function thin(mask, W, H) {
  const m = mask.slice();
  for (let x = 0; x < W; x++) { m[x] = 0; m[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { m[y * W] = 0; m[y * W + W - 1] = 0; }
  let pts = []; for (let i = 0; i < m.length; i++) if (m[i]) pts.push(i);
  let changed = true;
  while (changed) {
    changed = false;
    for (let it = 0; it < 2; it++) {
      const del = [];
      for (const p of pts) {
        if (!m[p]) continue;
        const p2 = m[p - W], p3 = m[p - W + 1], p4 = m[p + 1], p5 = m[p + W + 1],
              p6 = m[p + W], p7 = m[p + W - 1], p8 = m[p - 1], p9 = m[p - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (it === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; }
        else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
        del.push(p);
      }
      for (const p of del) m[p] = 0;
      if (del.length) changed = true;
    }
    pts = pts.filter(p => m[p]);
  }
  return m;
}

// Draw a thick segment into a mask / float field
function stampSegment(arr, W, H, x0, y0, x1, y1, r, val) {
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - r)), maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - r)), maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r));
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9;
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    let t = ((x - x0) * dx + (y - y0) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + t * dx - x, ey = y0 + t * dy - y;
    if (ex * ex + ey * ey <= r * r) arr[y * W + x] = val;
  }
}
