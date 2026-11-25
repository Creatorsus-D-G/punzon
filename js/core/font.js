import { parsePath, segsToContours, orient, strokeContours, contoursBBox } from './path.js';

class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { this.a.push((v >> 8) & 255, v & 255); return this; }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.a.push(s.charCodeAt(i) & 255); return this; }
  bytes(b) { for (const v of b) this.a.push(v & 255); return this; }
  ascii(s) { for (let i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i) & 255); return this; }
  utf16(s) { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); this.a.push((c >> 8) & 255, c & 255); } return this; }
  pad(n = 4) { while (this.a.length % n) this.a.push(0); return this; }
  out() { return new Uint8Array(this.a); }
  get length() { return this.a.length; }
}

const checksum = (u8) => {
  let s = 0;
  for (let i = 0; i < u8.length; i += 4) {
    s = (s + (((u8[i] || 0) << 24 | (u8[i + 1] || 0) << 16 | (u8[i + 2] || 0) << 8 | (u8[i + 3] || 0)) >>> 0)) >>> 0;
  }
  return s >>> 0;
};

export function glyphContours(glyph, quality = { tol: 0.6, seg: 16 }) {
  const out = [];
  for (const o of glyph.objects || []) {
    if (o.visible === false) continue;
    if (o.type === 'stroke') {
      if (!o.pts || o.pts.length < 1) continue;
      out.push(...orient(strokeContours(o.pts, o.width || 20, !!o.closed, quality.seg), 'union'));
    } else if (o.d) {
      const cs = segsToContours(parsePath(o.d), quality.tol);
      out.push(...orient(cs, o.mode === 'union' ? 'union' : o.mode === 'hole' ? 'hole' : 'nest'));
    }
  }
  return out;
}

function glyfEntry(contours) {
  if (!contours.length) return { bytes: new Uint8Array(0), bbox: null, points: 0, contours: 0 };
  const pts = [], ends = [];
  for (const c of contours) {
    for (const p of c) pts.push({ x: Math.round(p.x), y: Math.round(p.y), on: p.on });
    ends.push(pts.length - 1);
  }
  const bb = contoursBBox(pts);
  const w = new W();
  w.i16(contours.length).i16(Math.round(bb.x0)).i16(Math.round(bb.y0)).i16(Math.round(bb.x1)).i16(Math.round(bb.y1));
  ends.forEach((e) => w.u16(e));
  w.u16(0); // instructionLength
  const flags = [], xs = [], ys = [];
  let px = 0, py = 0;
  for (const p of pts) {
    let f = p.on ? 1 : 0;
    const dx = p.x - px, dy = p.y - py;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) <= 255) { f |= 0x02; if (dx > 0) f |= 0x10; xs.push({ s: 1, v: Math.abs(dx) }); }
    else xs.push({ s: 0, v: dx });
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) <= 255) { f |= 0x04; if (dy > 0) f |= 0x20; ys.push({ s: 1, v: Math.abs(dy) }); }
    else ys.push({ s: 0, v: dy });
    flags.push(f); px = p.x; py = p.y;
  }
  w.bytes(flags);
  for (const t of xs) t.s ? w.u8(t.v) : w.i16(t.v);
  for (const t of ys) t.s ? w.u8(t.v) : w.i16(t.v);
  w.pad(4);
  return {
    bytes: w.out(),
    bbox: { x0: Math.round(bb.x0), y0: Math.round(bb.y0), x1: Math.round(bb.x1), y1: Math.round(bb.y1) },
    points: pts.length, contours: contours.length
  };
}

function cmapTable(map) {
  const entries = [...map.entries()].filter(([c]) => c <= 0xffff).sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (const [code, gid] of entries) {
    const last = segs[segs.length - 1];
    if (last && code === last.end + 1 && gid === last.gid + (code - last.start)) last.end = code;
    else segs.push({ start: code, end: code, gid });
  }
  segs.push({ start: 0xffff, end: 0xffff, gid: 0 });
  const n = segs.length;
  const sr = 2 * Math.pow(2, Math.floor(Math.log2(n)));
  const sub = new W();
  sub.u16(4).u16(16 + 8 * n).u16(0);
  sub.u16(n * 2).u16(sr).u16(Math.floor(Math.log2(n))).u16(n * 2 - sr);
  segs.forEach((s) => sub.u16(s.end));
  sub.u16(0);
  segs.forEach((s) => sub.u16(s.start));
  segs.forEach((s) => sub.i16(s.start === 0xffff ? 1 : (s.gid - s.start) & 0xffff));
  segs.forEach(() => sub.u16(0));
  const subBytes = sub.out();
  const w = new W();
  w.u16(0).u16(2);
  w.u16(3).u16(1).u32(20);
  w.u16(0).u16(3).u32(20);
  w.bytes(subBytes);
  return w.out();
}

function nameTable(meta, psName) {
  const full = meta.style && meta.style !== 'Regular' ? `${meta.family} ${meta.style}` : meta.family;
  const strings = [
    [0, meta.copyright || `${new Date().getFullYear()} ${meta.designer || 'Punzón'}`],
    [1, meta.family], [2, meta.style || 'Regular'], [3, `${meta.version || '1.000'};${psName}`],
    [4, full], [5, `Version ${meta.version || '1.000'}`], [6, psName],
    [9, meta.designer || 'Punzón'],
    [13, meta.license || 'SIL Open Font License 1.1'], [14, 'https://openfontlicense.org/']
  ].filter(([, v]) => v);
  const macIds = new Set([1, 2, 4, 6]);
  const recs = [];
  const mac = new W(), win = new W();
  for (const [id, val] of strings) {
    if (macIds.has(id)) {
      const clean = String(val).normalize('NFD').replace(/[^\x20-\x7e]/g, '') || 'Punzon';
      recs.push({ p: 1, e: 0, l: 0, id, off: mac.length, len: clean.length, mac: true });
      mac.ascii(clean);
    }
    recs.push({ p: 3, e: 1, l: 0x409, id, off: win.length, len: String(val).length * 2, mac: false });
    win.utf16(String(val));
  }
  const macB = mac.out(), winB = win.out();
  const w = new W();
  w.u16(0).u16(recs.length).u16(6 + 12 * recs.length);
  for (const r of recs) w.u16(r.p).u16(r.e).u16(r.l).u16(r.id).u16(r.len).u16(r.mac ? r.off : r.off + macB.length);
  w.bytes(macB).bytes(winB);
  return w.out();
}

function os2Table(m, stats, codes) {
  const w = new W();
  const first = codes.length ? Math.min(...codes) : 0xffff;
  const last = codes.length ? Math.max(...codes) : 0;
  w.u16(4).i16(Math.round(stats.avgAdvance)).u16(m.weight || 400).u16(m.widthClass || 5).u16(0);
  w.i16(650).i16(600).i16(0).i16(75);
  w.i16(650).i16(600).i16(0).i16(350);
  w.i16(Math.round(m.upem * 0.05)).i16(Math.round(m.xHeight * 0.5)).i16(0);
  w.bytes([2, 0, 5, 3, 0, 0, 0, 0, 0, 0]); // PANOSE
  let r1 = 0;
  if (codes.some((c) => c < 0x80)) r1 |= 1;
  if (codes.some((c) => c >= 0x80 && c <= 0xff)) r1 |= 2;
  if (codes.some((c) => c >= 0x100 && c <= 0x17f)) r1 |= 4;
  w.u32(r1 >>> 0).u32(0).u32(0).u32(0);
  w.ascii('PNZN');
  w.u16(0x40 | 0x80); // REGULAR + USE_TYPO_METRICS
  w.u16(Math.min(first, 0xffff)).u16(Math.min(last, 0xffff));
  w.i16(m.asc).i16(m.desc).i16(m.gap);
  w.u16(Math.max(stats.yMax, m.asc)).u16(Math.max(0, -Math.min(stats.yMin, m.desc)));
  w.u32(1).u32(0);
  w.i16(m.xHeight).i16(m.capHeight).u16(0).u16(32).u16(2);
  return w.out();
}

function kernTable(pairs) {
  const n = pairs.length;
  const sr = 6 * Math.pow(2, Math.floor(Math.log2(n)));
  const len = 14 + n * 6;
  const sub = new W();
  sub.u16(0).u16(len).u16(1);
  sub.u16(n).u16(sr).u16(Math.floor(Math.log2(n))).u16(n * 6 - sr);
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(([l, r, v]) => sub.u16(l).u16(r).i16(v));
  const w = new W();
  w.u16(0).u16(1).u16(0).u16(len + 4);
  w.bytes(sub.out());
  return w.out();
}

export function buildFont(project, opts = {}) {
  const q = opts.quality || { tol: 0.6, seg: 16 };
  const M = project.metrics;
  const m = {
    upem: M.unitsPerEm, asc: M.ascender, desc: M.descender, gap: M.lineGap || 0,
    capHeight: M.capHeight, xHeight: M.xHeight,
    weight: project.meta.weight, widthClass: project.meta.widthClass
  };
  const warnings = [];
  const glyphs = [{ name: '.notdef', char: null, advance: Math.round(m.upem * 0.5), contours: [] }];
  const list = (project.order || []).map((k) => project.glyphs[k]).filter(Boolean);
  const seen = new Set();
  for (const g of list) {
    const code = g.unicode ?? (g.char ? g.char.codePointAt(0) : null);
    if (code == null) continue;
    if (code > 0xffff) { warnings.push(`«${g.char}» está fuera del BMP y se omitió (cmap formato 4).`); continue; }
    if (seen.has(code)) { warnings.push(`Unicode duplicado en «${g.char}».`); continue; }
    seen.add(code);
    const cs = glyphContours(g, q);
    if (!cs.length && code !== 32) warnings.push(`«${g.char}» no tiene contornos: saldrá en blanco.`);
    glyphs.push({ name: g.name || g.char, char: g.char, code, advance: Math.max(1, Math.round(g.advance)), contours: cs });
  }
  if (!seen.has(32)) {
    glyphs.splice(1, 0, { name: 'space', char: ' ', code: 32, advance: Math.round(m.upem * 0.28), contours: [] });
    warnings.push('Se añadió un glifo de espacio automático (280/1000 em).');
  }
  if (glyphs.length < 2) throw new Error('Dibuja al menos un glifo antes de exportar.');

  const entries = glyphs.map((g) => glyfEntry(g.contours));
  const glyf = new W(), loca = new W();
  entries.forEach((e) => { loca.u32(glyf.length); glyf.bytes(e.bytes); });
  loca.u32(glyf.length);

  const stats = { yMax: 0, yMin: 0, xMax: 0, minLsb: 0, minRsb: 0, avgAdvance: 0, maxPoints: 0, maxContours: 0 };
  let advMax = 0, advSum = 0;
  glyphs.forEach((g, i) => {
    const b = entries[i].bbox;
    advMax = Math.max(advMax, g.advance); advSum += g.advance;
    stats.maxPoints = Math.max(stats.maxPoints, entries[i].points);
    stats.maxContours = Math.max(stats.maxContours, entries[i].contours);
    if (!b) return;
    stats.yMax = Math.max(stats.yMax, b.y1);
    stats.yMin = Math.min(stats.yMin, b.y0);
    stats.xMax = Math.max(stats.xMax, b.x1);
    stats.minLsb = Math.min(stats.minLsb, b.x0);
    stats.minRsb = Math.min(stats.minRsb, g.advance - b.x1);
  });
  stats.avgAdvance = advSum / glyphs.length;

  const hmtx = new W();
  glyphs.forEach((g, i) => { const b = entries[i].bbox; hmtx.u16(g.advance).i16(b ? b.x0 : 0); });

  const now = Math.floor(Date.now() / 1000) + 2082844800; // segundos desde 1904-01-01
  const head = new W();
  head.u32(0x00010000).u32(Math.round((parseFloat(project.meta.version) || 1) * 65536));
  head.u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(m.upem);
  head.u32(0).u32(now).u32(0).u32(now);
  head.i16(Math.min(0, stats.minLsb)).i16(stats.yMin).i16(stats.xMax).i16(stats.yMax);
  head.u16(project.meta.style === 'Bold' ? 1 : 0).u16(8).i16(2).i16(1).i16(0);

  const hhea = new W();
  hhea.u32(0x00010000).i16(m.asc).i16(m.desc).i16(m.gap);
  hhea.u16(advMax).i16(stats.minLsb).i16(stats.minRsb).i16(stats.xMax);
  hhea.i16(1).i16(project.meta.italicAngle ? Math.round(Math.tan((-project.meta.italicAngle * Math.PI) / 180) * 1000) : 0).i16(0);
  hhea.i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length);

  const maxp = new W();
  maxp.u32(0x00010000).u16(glyphs.length).u16(stats.maxPoints).u16(stats.maxContours);
  maxp.u16(0).u16(0).u16(1).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

  const post = new W();
  post.u32(0x00030000).u32(0).i16(-Math.round(m.upem * 0.1)).i16(Math.round(m.upem * 0.05));
  post.u32(0).u32(0).u32(0).u32(0).u32(0);

  const map = new Map();
  glyphs.forEach((g, i) => { if (g.code != null) map.set(g.code, i); });
  const psName = `${project.meta.family}-${project.meta.style || 'Regular'}`
    .normalize('NFD').replace(/[^A-Za-z0-9-]/g, '').slice(0, 60) || 'Punzon-Regular';

  const tables = {
    'OS/2': os2Table(m, stats, [...map.keys()]),
    cmap: cmapTable(map),
    glyf: glyf.out(),
    head: head.out(),
    hhea: hhea.out(),
    hmtx: hmtx.out(),
    loca: loca.out(),
    maxp: maxp.out(),
    name: nameTable(project.meta, psName),
    post: post.out()
  };
  const pairs = (project.kerning || []).map((k) => {
    const l = glyphs.findIndex((g) => g.char === k.left);
    const r = glyphs.findIndex((g) => g.char === k.right);
    return l > 0 && r > 0 ? [l, r, Math.round(k.value)] : null;
  }).filter(Boolean);
  if (pairs.length) tables.kern = kernTable(pairs);

  const bytes = assemble(tables);
  return {
    bytes, warnings, psName,
    stats: { glyphs: glyphs.length, points: stats.maxPoints, size: bytes.length, tables: Object.keys(tables).length, pairs: pairs.length }
  };
}

function assemble(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const sr = 16 * Math.pow(2, Math.floor(Math.log2(n)));
  const header = new W();
  header.u32(0x00010000).u16(n).u16(sr).u16(Math.floor(Math.log2(n))).u16(n * 16 - sr);
  let offset = 12 + n * 16;
  const dir = new W(), body = new W();
  const info = {};
  for (const t of tags) {
    const data = tables[t];
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    dir.tag(t).u32(checksum(padded)).u32(offset).u32(data.length);
    info[t] = { offset };
    body.bytes(padded);
    offset += padded.length;
  }
  const dirB = dir.out(), bodyB = body.out();
  const total = new Uint8Array(12 + dirB.length + bodyB.length);
  total.set(header.out(), 0);
  total.set(dirB, 12);
  total.set(bodyB, 12 + dirB.length);
  const adj = (0xb1b0afba - checksum(total)) >>> 0;
  const ho = info.head.offset + 8;
  total[ho] = (adj >>> 24) & 255;
  total[ho + 1] = (adj >>> 16) & 255;
  total[ho + 2] = (adj >>> 8) & 255;
  total[ho + 3] = adj & 255;
  return total;
}

async function zlib(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

export async function buildWoff(ttf) {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = dv.getUint16(4);
  const recs = [];
  let totalSfnt = 12 + 16 * n;
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(ttf[o], ttf[o + 1], ttf[o + 2], ttf[o + 3]);
    const cs = dv.getUint32(o + 4), off = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
    const orig = ttf.subarray(off, off + len);
    const comp = await zlib(orig);
    const data = comp && comp.length < len ? comp : orig;
    recs.push({ tag, cs, orig: len, data });
    totalSfnt += Math.ceil(len / 4) * 4;
  }
  let offset = 44 + 20 * n;
  const dir = new W(), body = new W();
  for (const r of recs) {
    dir.tag(r.tag).u32(offset).u32(r.data.length).u32(r.orig).u32(r.cs);
    const b = new Uint8Array(Math.ceil(r.data.length / 4) * 4);
    b.set(r.data);
    body.bytes(b);
    offset += b.length;
  }
  const dirB = dir.out(), bodyB = body.out();
  const h = new W();
  h.tag('wOFF').u32(0x00010000).u32(44 + dirB.length + bodyB.length).u16(n).u16(0);
  h.u32(totalSfnt).u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
  const out = new Uint8Array(44 + dirB.length + bodyB.length);
  out.set(h.out(), 0);
  out.set(dirB, 44);
  out.set(bodyB, 44 + dirB.length);
  return out;
}

const liveFaces = new Map();
export async function previewFace(key, bytes) {
  const family = `PunzonLive_${key}`;
  const old = liveFaces.get(key);
  if (old) { try { document.fonts.delete(old); } catch {} }
  const face = new FontFace(family, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  await face.load();
  document.fonts.add(face);
  liveFaces.set(key, face);
  return family;
}

export function fontCSS(family, file) {
  return `@font-face{\n  font-family:"${family}";\n  src:url("${file}.woff") format("woff"),\n      url("${file}.ttf") format("truetype");\n  font-display:swap;\n}\n\nbody{ font-family:"${family}", system-ui, sans-serif; }`;
}
