// ===== Line-art pipeline: binarize → clean → connect → smooth =====

function binarize(gray, W, H, p, s) {
  const g = gaussBlur(gray, W, H, 0.8);
  let m;
  if (p.thMode === 'adaptive') {
    m = adaptiveMask(g, W, H, Math.max(15, Math.round(3 / s) | 1), p.adaptC);
  } else {
    const th = p.thMode === 'auto' ? autoThreshold(g) : p.threshold;
    m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = g[i] < th ? 1 : 0;
  }
  if (p.invert) for (let i = 0; i < m.length; i++) m[i] ^= 1;
  m = closing(m, W, H, 2);
  return m;
}
function autoThreshold(g) {
  const o = otsu(g);
  // a bit more generous than Otsu so faint pencil strokes survive
  return Math.round(o + (255 - o) * 0.45);
}

// strokes are stored in source-image coordinates (0..1) with a radius in mm
function applyEdits(m, W, H, s, ec, strokes) {
  const X = u => (u - ec.x0) / (ec.x1 - ec.x0) * W, Y = v => (v - ec.y0) / (ec.y1 - ec.y0) * H;
  for (const st of strokes) {
    const r = Math.max(1, st.rmm / s), v = st.mode === 'erase' ? 0 : 1;
    for (let i = 0; i < st.pts.length; i++) {
      const a = st.pts[Math.max(0, i - 1)], b = st.pts[i];
      stampSegment(m, W, H, X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), r, v);
    }
  }
}

function removeSpecks(m, W, H, minArea) {
  const { lab, areas } = label(m, W, H);
  for (let i = 0; i < m.length; i++) if (m[i] && areas[lab[i]] < minArea) m[i] = 0;
}

function addBottomBar(m, W, H, barPx) {
  let minx = W, maxx = -1, maxy = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) {
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
  if (maxx < 0) return;
  for (let y = Math.max(0, maxy - barPx + 1); y <= maxy; y++)
    for (let x = minx; x <= maxx; x++) m[y * W + x] = 1;
}

// thicken strokes that are thinner than the printable minimum
function thickenThin(m, W, H, rMin) {
  const op = opening(m, W, H, rMin);
  const thin = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) thin[i] = m[i] && !op[i] ? 1 : 0;
  const near = dilate(thin, W, H, rMin + 2), grown = dilate(m, W, H, rMin);
  const out = m.slice();
  for (let i = 0; i < m.length; i++) if (near[i] && grown[i]) out[i] = 1;
  return out;
}

// connect islands to the main body with short bridges (or drop them)
function resolveIslands(m, W, H, rMin, bridgeR, mode, stats) {
  let out = m.slice(); stats.bridges = 0; stats.dropped = 0;
  for (let iter = 0; iter < 25; iter++) {
    const op = opening(out, W, H, rMin);
    const { lab, n, areas } = label(op, W, H);
    if (n <= 1) break;
    let main = 1; for (let k = 2; k <= n; k++) if (areas[k] > areas[main]) main = k;
    if (mode === 'remove') {
      const keep = new Uint8Array(W * H);
      for (let i = 0; i < keep.length; i++) keep[i] = lab[i] === main ? 1 : 0;
      stats.dropped += n - 1; out = keep; break;
    }
    const mm = new Uint8Array(W * H); for (let i = 0; i < mm.length; i++) mm[i] = lab[i] === main ? 1 : 0;
    const { d2, idx } = edt(mm, W, H);
    const best = new Float64Array(n + 1).fill(Infinity), bp = new Int32Array(n + 1).fill(-1);
    for (let i = 0; i < lab.length; i++) { const l = lab[i]; if (l && l !== main && d2[i] < best[l]) { best[l] = d2[i]; bp[l] = i; } }
    // bridge the closest island first; others may get connected through it
    let first = -1; for (let k = 1; k <= n; k++) if (k !== main && (first < 0 || best[k] < best[first])) first = k;
    const order = [first];
    for (let k = 1; k <= n; k++) if (k !== main && k !== first && Math.sqrt(best[k]) < 3 * bridgeR) order.push(k);
    for (const k of order) {
      const p = bp[k], q = idx[p];
      stampSegment(out, W, H, p % W, (p / W) | 0, q % W, (q / W) | 0, bridgeR, 1);
      stats.bridges++;
    }
  }
  // anything still not attached to the main body (tiny dots) is removed
  const { lab, n, areas } = label(out, W, H);
  if (n > 1) { let main = 1; for (let k = 2; k <= n; k++) if (areas[k] > areas[main]) main = k;
    for (let i = 0; i < out.length; i++) if (out[i] && lab[i] !== main) out[i] = 0; }
  return out;
}

// ----- skeleton graph -----
const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
function skeletonGraph(sk, W, H) {
  const deg = new Uint8Array(W * H), pix = [];
  for (let i = 0; i < sk.length; i++) if (sk[i]) { pix.push(i);
    const x = i % W, y = (i / W) | 0; let c = 0;
    for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && sk[yy * W + xx]) c++; }
    deg[i] = c; }
  const isNode = i => sk[i] && deg[i] !== 2;
  // cluster adjacent node pixels into one node
  const cl = new Int32Array(W * H).fill(-1); let nc = 0;
  for (const p of pix) if (isNode(p) && cl[p] < 0) {
    const st = [p]; cl[p] = nc;
    while (st.length) { const q = st.pop(), x = q % W, y = (q / W) | 0;
      for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const r = yy * W + xx; if (isNode(r) && cl[r] < 0) { cl[r] = nc; st.push(r); } } }
    nc++; }
  const nbrs = q => { const x = q % W, y = (q / W) | 0, o = [];
    for (const [dx, dy] of NB) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && sk[yy * W + xx]) o.push(yy * W + xx); }
    return o; };
  const vis = new Uint8Array(W * H), edges = [];
  for (const p of pix) if (isNode(p)) {
    for (const q of nbrs(p)) {
      if (isNode(q) || vis[q]) continue;
      const path = [p, q]; vis[q] = 1; let prev = p, cur = q, end = -1;
      for (;;) {
        const nx = nbrs(cur).filter(r => r !== prev && (isNode(r) ? cl[r] !== cl[p] || path.length > 3 : !vis[r]));
        let nxt = nx.find(r => !isNode(r)); const nodeN = nx.find(r => isNode(r));
        if (nodeN !== undefined) { path.push(nodeN); end = nodeN; break; }
        if (nxt === undefined) break;
        vis[nxt] = 1; path.push(nxt); prev = cur; cur = nxt;
      }
      edges.push({ a: cl[p], b: end >= 0 ? cl[end] : -1, pts: path, closed: false });
    }
  }
  // free-standing loops
  for (const p of pix) if (!isNode(p) && !vis[p]) {
    const path = [p]; vis[p] = 1; let prev = -1, cur = p;
    for (;;) { const nxt = nbrs(cur).find(r => r !== prev && !vis[r]); if (nxt === undefined) break; vis[nxt] = 1; path.push(nxt); prev = cur; cur = nxt; }
    if (path.length > 2) edges.push({ a: -1, b: -1, pts: path, closed: true });
  }
  // dangling ends (b === -1) become their own leaf node
  for (const e of edges) if (!e.closed && e.b < 0) e.b = nc++;
  return { edges, nc };
}

function simplifyGraph(g, spurLen) {
  let edges = g.edges.filter(e => (e.closed ? e.pts.length >= spurLen : !(e.a === e.b && e.pts.length <= spurLen)));
  const degOf = () => { const d = new Map(); for (const e of edges) if (!e.closed) { d.set(e.a, (d.get(e.a) || 0) + 1); d.set(e.b, (d.get(e.b) || 0) + 1); } return d; };
  for (let round = 0; round < 4; round++) {
    const d = degOf();
    const before = edges.length;
    edges = edges.filter(e => e.closed || e.a === e.b || !((d.get(e.a) === 1 || d.get(e.b) === 1) && e.pts.length < spurLen && !(d.get(e.a) === 1 && d.get(e.b) === 1 && e.pts.length >= spurLen / 2)));
    // merge chains through degree-2 nodes
    let merged = true;
    while (merged) {
      merged = false; const inc = new Map();
      for (const e of edges) if (!e.closed) for (const n of [e.a, e.b]) { if (!inc.has(n)) inc.set(n, []); inc.get(n).push(e); }
      for (const [n, list] of inc) {
        if (list.length !== 2 || list[0] === list[1]) continue;
        let [e1, e2] = list;
        if (e1.a === n) { e1.pts.reverse(); [e1.a, e1.b] = [e1.b, e1.a]; }
        if (e2.b === n) { e2.pts.reverse(); [e2.a, e2.b] = [e2.b, e2.a]; }
        const ne = { a: e1.a, b: e2.b, pts: e1.pts.concat(e2.pts), closed: false };
        if (ne.a === ne.b && ne.a === n) ne.closed = true;
        edges = edges.filter(e => e !== e1 && e !== e2); edges.push(ne); merged = true; break;
      }
    }
    if (edges.length === before) break;
  }
  return edges;
}

function smoothPath(xy, sigma, closed) {
  const n = xy.length;
  if (n < 6 || sigma < 0.3) return xy;
  sigma = Math.min(sigma, n / 6);
  const r = Math.ceil(sigma * 3), k = []; let s = 0;
  for (let i = -r; i <= r; i++) { const w = Math.exp(-i * i / (2 * sigma * sigma)); k.push(w); s += w; }
  const out = [];
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = 0;
    for (let j = -r; j <= r; j++) {
      let t = i + j;
      if (closed) t = ((t % n) + n) % n; else t = t < 0 ? 0 : t >= n ? n - 1 : t;
      ax += xy[t][0] * k[j + r]; ay += xy[t][1] * k[j + r];
    }
    out.push([ax / s, ay / s]);
  }
  if (!closed) { out[0] = xy[0]; out[n - 1] = xy[n - 1]; }
  return out;
}

// Rebuild strokes as smooth, constant-width lines; keep big filled areas as smoothed fills.
function uniformLines(m, W, H, s, p) {
  const core0 = p.noFill ? new Uint8Array(W * H) : opening(m, W, H, Math.max(2, Math.round(1.0 / s)));
  const core = dilate(core0, W, H, 1); for (let i = 0; i < core.length; i++) core[i] &= m[i];
  const fill = gaussBlur(core, W, H, 0.45 / s);
  const inside = erode(core, W, H, Math.round(0.45 / s));
  const sk = thin(m, W, H); for (let i = 0; i < sk.length; i++) if (inside[i]) sk[i] = 0;
  const g = skeletonGraph(sk, W, H);
  const edges = simplifyGraph(g, Math.round(1.4 / s));
  const SS = 2, cv = document.createElement('canvas'); cv.width = W * SS; cv.height = H * SS;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = (p.lineWidth / s) * SS;
  const sig = p.smoothness / s;
  for (const e of edges) {
    let xy = e.pts.map(i => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    xy = smoothPath(xy, sig, e.closed);
    ctx.beginPath(); ctx.moveTo(xy[0][0] * SS, xy[0][1] * SS);
    for (let i = 1; i < xy.length; i++) ctx.lineTo(xy[i][0] * SS, xy[i][1] * SS);
    if (e.closed) ctx.closePath();
    if (xy.length === 1) { ctx.arc(xy[0][0] * SS, xy[0][1] * SS, ctx.lineWidth / 2, 0, 7); ctx.fill(); } else ctx.stroke();
  }
  const id = ctx.getImageData(0, 0, cv.width, cv.height).data, field = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0; for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) a += id[((y * SS + j) * cv.width + x * SS + i) * 4];
    field[y * W + x] = Math.max(a / (255 * SS * SS), fill[y * W + x]);
  }
  return gaussBlur(field, W, H, 0.1 / s);
}

function fieldToMask(f) { const m = new Uint8Array(f.length); for (let i = 0; i < f.length; i++) m[i] = f[i] > 0.5 ? 1 : 0; return m; }
function maskToField(m, W, H, sigma) { return gaussBlur(m, W, H, sigma); }
