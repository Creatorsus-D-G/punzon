import { rectSegs, ellipseSegs, segsToD } from './path.js';
import { uid } from './vector.js';

export const CHAR_NAMES = { ' ': 'space', '.': 'period', ',': 'comma', '!': 'exclam', '?': 'question', '-': 'hyphen', '"': 'quotedbl', "'": 'quotesingle', ':': 'colon', ';': 'semicolon', '(': 'parenleft', ')': 'parenright', '@': 'at', '#': 'numbersign', '%': 'percent', '&': 'ampersand', '*': 'asterisk', '+': 'plus', '=': 'equal', '/': 'slash', '\\': 'backslash', '_': 'underscore', '$': 'dollar', '€': 'euro', '<': 'less', '>': 'greater', '[': 'bracketleft', ']': 'bracketright', '{': 'braceleft', '}': 'braceright', '–': 'endash', '—': 'emdash', '¡': 'exclamdown', '¿': 'questiondown' };
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const glyphName = (ch) => CHAR_NAMES[ch] || (/[0-9]/.test(ch) ? DIGITS[+ch] : ch);

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function emptyGlyph(ch, advance = 600) {
  const c = ch || ' ';
  return { char: c, name: glyphName(c), unicode: c.codePointAt(0), advance, objects: [], tags: [], modified: Date.now() };
}

export function newProject(family = 'Punzón Sans', designer = 'Leonel') {
  const now = Date.now();
  return {
    id: uid(), format: 'punzon.font.project', version: 1,
    meta: { family, style: 'Regular', designer, version: '1.000', license: 'SIL Open Font License 1.1', copyright: `${new Date().getFullYear()} ${designer}`, weight: 400, widthClass: 5, italicAngle: 0, created: now, modified: now },
    metrics: { unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 500, lineGap: 0 },
    editor: { grid: true, guides: true, snap: false, fill: true, ghost: '', quality: 'alta', brush: 26, smooth: 0.5, simplify: 2.4, tint: '#F2A03D' },
    glyphs: {}, order: [], kerning: [], tags: ['nuevo']
  };
}

/* ---------- semillas ---------- */
const P = (segs, mode = 'nest') => ({ id: uid(), type: 'path', d: segsToD(segs), mode, visible: true });
const S = (pts, width) => ({ id: uid(), type: 'stroke', pts, width, closed: false, visible: true });
const arc = (cx, cy, r, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
const ring = (cx, cy, r, t) => [P(ellipseSegs(cx, cy, r, r)), P(ellipseSegs(cx, cy, r - t, r - t), 'hole')];

function put(p, ch, advance, objects, tags = []) {
  const g = emptyGlyph(ch, advance);
  g.objects = objects; g.tags = tags;
  p.glyphs[ch] = g; p.order.push(ch);
  return g;
}

export function seedProjects() {
  const a = newProject('Brasa Display', 'Leonel');
  a.tags = ['display', 'geométrica'];
  put(a, 'A', 570, [
    P([{ cmd: 'M', x: 40, y: 0 }, { cmd: 'L', x: 140, y: 0 }, { cmd: 'L', x: 320, y: 700 }, { cmd: 'L', x: 230, y: 700 }, { cmd: 'Z' }]),
    P([{ cmd: 'M', x: 430, y: 0 }, { cmd: 'L', x: 530, y: 0 }, { cmd: 'L', x: 340, y: 700 }, { cmd: 'L', x: 250, y: 700 }, { cmd: 'Z' }]),
    P(rectSegs(160, 210, 250, 80))
  ], ['mayúsculas']);
  put(a, 'B', 600, [P(rectSegs(70, 0, 95, 700)), ...ring(280, 525, 175, 90), ...ring(300, 180, 180, 90)], ['mayúsculas']);
  put(a, 'E', 540, [P(rectSegs(70, 0, 95, 700)), P(rectSegs(70, 610, 400, 90)), P(rectSegs(70, 310, 340, 85)), P(rectSegs(70, 0, 400, 90))], ['mayúsculas']);
  put(a, 'L', 520, [P(rectSegs(70, 0, 95, 700)), P(rectSegs(70, 0, 400, 90))], ['mayúsculas']);
  put(a, 'N', 620, [P(rectSegs(70, 0, 95, 700)), P(rectSegs(455, 0, 95, 700)), P([{ cmd: 'M', x: 165, y: 700 }, { cmd: 'L', x: 265, y: 700 }, { cmd: 'L', x: 455, y: 0 }, { cmd: 'L', x: 355, y: 0 }, { cmd: 'Z' }])], ['mayúsculas']);
  put(a, 'O', 640, ring(320, 350, 300, 95), ['mayúsculas']);
  put(a, 'P', 580, [P(rectSegs(70, 0, 95, 700)), ...ring(290, 520, 180, 92)], ['mayúsculas']);
  put(a, 'S', 560, [S([...arc(300, 520, 165, 20, 200, 14), ...arc(280, 190, 165, 20, -160, 14)], 92)], ['mayúsculas']);
  put(a, 'U', 620, [P(rectSegs(70, 130, 95, 570)), P(rectSegs(455, 130, 95, 570)), P(rectSegs(70, 0, 480, 95))], ['mayúsculas']);
  put(a, 'Z', 560, [P(rectSegs(70, 610, 420, 90)), P(rectSegs(70, 0, 420, 90)), P([{ cmd: 'M', x: 490, y: 610 }, { cmd: 'L', x: 390, y: 610 }, { cmd: 'L', x: 90, y: 90 }, { cmd: 'L', x: 190, y: 90 }, { cmd: 'Z' }])], ['mayúsculas']);
  put(a, ' ', 280, [], ['espacio']);
  a.kerning = [{ left: 'A', right: 'V', value: -50 }, { left: 'P', right: 'A', value: -40 }];

  const b = newProject('Nodo Mono', 'Leonel');
  b.tags = ['monolínea', 'mono'];
  const w = 88, adv = 560;
  put(b, 'N', adv, [S([[110, 0], [110, 620], [450, 0], [450, 620]], w)]);
  put(b, 'O', adv, [S(arc(280, 310, 210, 0, 360, 28), w)]);
  put(b, 'D', adv, [S([[110, 0], [110, 620], [260, 620], [430, 450], [430, 170], [260, 0], [110, 0]], w)]);
  put(b, 'E', adv, [S([[440, 620], [110, 620], [110, 310], [380, 310]], w), S([[110, 310], [110, 0], [440, 0]], w)]);
  put(b, 'I', adv, [S([[280, 0], [280, 620]], w), S([[150, 620], [410, 620]], w), S([[150, 0], [410, 0]], w)]);
  put(b, 'L', adv, [S([[130, 620], [130, 0], [440, 0]], w)]);
  put(b, 'T', adv, [S([[90, 620], [470, 620]], w), S([[280, 620], [280, 0]], w)]);
  put(b, ' ', 280, []);
  b.metrics.capHeight = 620;

  const c = newProject('Trazo Libre', 'Leonel');
  c.tags = ['manuscrita', 'trazo'];
  const jitter = (pts, s) => pts.map(([x, y], i) => [x + Math.sin(i * 1.7 + s) * 7, y + Math.cos(i * 2.1 + s) * 7]);
  put(c, 'h', 480, [S(jitter([[90, 700], [95, 480], [100, 240], [105, 20]], 1), 62), S(jitter([[105, 330], [180, 430], [290, 420], [350, 300], [360, 20]], 2), 62)]);
  put(c, 'o', 460, [S(jitter(arc(230, 230, 160, 0, 360, 20), 3), 62)]);
  put(c, 'l', 260, [S(jitter([[120, 720], [125, 460], [130, 200], [140, 20]], 4), 62)]);
  put(c, 'a', 480, [S(jitter(arc(210, 230, 150, 0, 360, 20), 5), 62), S(jitter([[360, 400], [365, 200], [370, 40], [430, 20]], 6), 62)]);
  put(c, ' ', 260, []);
  c.metrics.xHeight = 460;

  const now = Date.now();
  a.meta.modified = now - 3600e3;
  b.meta.modified = now - 86400e3;
  c.meta.modified = now - 3 * 86400e3;
  return [a, b, c];
}

/* ---------- normalización y validación ---------- */
export function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = newProject();
  const p = {
    ...base, ...src,
    meta: { ...base.meta, ...(src.meta || {}) },
    metrics: { ...base.metrics, ...(src.metrics || {}) },
    editor: { ...base.editor, ...(src.editor || {}) }
  };
  p.glyphs = {};
  const incoming = Array.isArray(src.glyphs) ? src.glyphs : Object.values(src.glyphs || {});
  for (const g of incoming) {
    if (!g || typeof g !== 'object') continue;
    const ch = typeof g.char === 'string' && g.char.length ? g.char : null;
    if (!ch) continue;
    p.glyphs[ch] = {
      char: ch,
      name: g.name || glyphName(ch),
      unicode: Number.isFinite(g.unicode) ? g.unicode : ch.codePointAt(0),
      advance: Math.max(1, Math.round(g.advance || 600)),
      objects: (Array.isArray(g.objects) ? g.objects : []).filter(Boolean).map((o) => ({ ...o, id: o.id || uid(), visible: o.visible !== false })),
      tags: Array.isArray(g.tags) ? g.tags : [],
      modified: g.modified || Date.now()
    };
  }
  const order = Array.isArray(src.order) ? src.order : [];
  p.order = [...new Set(order.filter((k) => typeof k === 'string' && p.glyphs[k]))];
  for (const k of Object.keys(p.glyphs)) if (!p.order.includes(k)) p.order.push(k);
  p.kerning = Array.isArray(src.kerning) ? src.kerning.filter((k) => k && k.left && k.right) : [];
  p.tags = Array.isArray(src.tags) ? src.tags : [];
  p.id = src.id || uid();

  const m = p.metrics;
  m.unitsPerEm = Math.min(16384, Math.max(16, Math.round(m.unitsPerEm || 1000)));
  m.ascender = Math.round(m.ascender ?? m.unitsPerEm * 0.8);
  m.descender = Math.round(m.descender ?? -m.unitsPerEm * 0.2);
  m.capHeight = Math.round(m.capHeight ?? m.ascender * 0.875);
  m.xHeight = Math.round(m.xHeight ?? m.ascender * 0.625);
  m.lineGap = Math.round(m.lineGap || 0);
  if (!p.meta.family) p.meta.family = 'Punzón Sans';
  if (!p.meta.style) p.meta.style = 'Regular';
  return p;
}

export function validate(p) {
  const issues = [];
  const drawn = p.order.filter((k) => p.glyphs[k].objects.length);
  if (!drawn.length) issues.push({ level: 'error', msg: 'No hay ningún glifo dibujado todavía.' });
  if (!p.glyphs[' ']) issues.push({ level: 'warn', msg: 'Falta el espacio: se generará automáticamente a 280/1000 em.' });
  for (const k of drawn) {
    const g = p.glyphs[k];
    if (g.unicode > 0xffff) issues.push({ level: 'warn', msg: `«${k}» está fuera del BMP y no podrá exportarse con cmap formato 4.` });
    for (const o of g.objects) {
      if (o.type === 'path' && !/z\s*$/i.test(String(o.d || '').trim())) issues.push({ level: 'warn', msg: `«${k}» tiene un path abierto; se cerrará automáticamente.` });
    }
    if (g.advance < 40) issues.push({ level: 'warn', msg: `«${k}» tiene un ancho muy pequeño (${g.advance}).` });
  }
  if (drawn.length && drawn.length < 8) issues.push({ level: 'info', msg: `Sólo ${drawn.length} glifos: suficiente para probar, corto para escribir.` });
  return issues;
}

export const countDrawn = (p) => p.order.filter((k) => p.glyphs[k]?.objects?.length).length;

/* ---------- almacén ---------- */
const DB = 'punzon', VER = 1;
const mem = { projects: new Map(), kv: new Map() };
let dbp = null, dbDead = false;

function db() {
  if (dbDead) return Promise.reject(new Error('IndexedDB no disponible'));
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('IndexedDB no disponible'));
    let req;
    try { req = indexedDB.open(DB, VER); } catch (e) { return rej(e); }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('Fallo al abrir IndexedDB'));
    req.onblocked = () => rej(new Error('IndexedDB bloqueada por otra pestaña'));
  });
  dbp.catch(() => { dbDead = true; });
  return dbp;
}

async function tx(storeName, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, mode);
    const r = fn(t.objectStore(storeName));
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transacción abortada'));
  });
}

export const store = {
  async all() {
    try { return (await tx('projects', 'readonly', (s) => s.getAll())) || []; }
    catch { return [...mem.projects.values()]; }
  },
  async get(id) {
    if (!id) return null;
    try { return (await tx('projects', 'readonly', (s) => s.get(id))) || mem.projects.get(id) || null; }
    catch { return mem.projects.get(id) || null; }
  },
  async put(p) {
    if (!p || !p.id) return false;
    p.meta = p.meta || {};
    p.meta.modified = Date.now();
    try { await tx('projects', 'readwrite', (s) => s.put(p)); }
    catch { mem.projects.set(p.id, clone(p)); }
    return true;
  },
  async del(id) {
    mem.projects.delete(id);
    try { await tx('projects', 'readwrite', (s) => s.delete(id)); } catch {}
    return true;
  },
  async kvGet(k) {
    try { const v = await tx('kv', 'readonly', (s) => s.get(k)); return v === undefined ? (mem.kv.get(k) ?? null) : v; }
    catch { return mem.kv.get(k) ?? null; }
  },
  async kvSet(k, v) {
    mem.kv.set(k, v);
    try { await tx('kv', 'readwrite', (s) => s.put(v, k)); } catch {}
    return true;
  }
};

// Sólo siembra la primera vez. Si el usuario borra todo, no se resucitan las semillas.
export async function ensureSeeds() {
  const list = await store.all();
  if (list.length) return list;
  if (await store.kvGet('seeded')) return list;
  const seeds = seedProjects();
  for (const s of seeds) await store.put(s);
  await store.kvSet('seeded', 1);
  await store.kvSet('order', seeds.map((s) => s.id));
  return seeds;
}

export async function currentProject() {
  let p = await store.get(lsGet('punzon.current'));
  if (!p) {
    const all = await ensureSeeds();
    p = all[0] || null;
  }
  if (!p) {
    p = newProject('Punzón Sans', lsGet('punzon.designer') || 'Leonel');
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ') {
      p.glyphs[ch] = emptyGlyph(ch, ch === ' ' ? 280 : 600);
      p.order.push(ch);
    }
    await store.put(p);
  }
  p = normalize(p);
  lsSet('punzon.current', p.id);
  return p;
}

export async function setCurrent(id) { if (id) lsSet('punzon.current', id); }
