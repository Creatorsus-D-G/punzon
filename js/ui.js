export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const fmt = (n) => new Intl.NumberFormat('es').format(n);
export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
export const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
}

let CONFIG = null;
export async function config() {
  if (CONFIG) return CONFIG;
  const res = await fetch('data/config.json');
  if (!res.ok) throw new Error('No se pudo cargar data/config.json');
  CONFIG = await res.json();
  return CONFIG;
}

/* ---------- sonido opcional, apagado por defecto ---------- */
let AC = null;
export const sound = {
  get on() { return localStorage.getItem('punzon.sound') === '1'; },
  set on(v) { localStorage.setItem('punzon.sound', v ? '1' : '0'); },
  play(kind = 'tick') {
    if (!this.on) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      const t = AC.currentTime;
      const o = AC.createOscillator(), g = AC.createGain();
      const map = { tick: [880, 0.035, 0.045], commit: [523, 0.10, 0.07], done: [784, 0.20, 0.075], error: [180, 0.16, 0.06] };
      const [f, d, vol] = map[kind] || map.tick;
      o.type = kind === 'error' ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, t);
      if (kind === 'done') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + d);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(AC.destination);
      o.start(t); o.stop(t + d + 0.02);
    } catch {}
  }
};

/* ---------- arranque de página ---------- */
export async function initShell(active) {
  const cfg = await config();

  // Normaliza el manifiesto al nombre nuevo sin tener que editar todavía los otros HTML.
  const ml = document.querySelector('link[rel="manifest"]');
  if (ml && /manifest\.webmanifest$/i.test(ml.getAttribute('href') || '')) ml.setAttribute('href', 'manifest.json');

  const brand = localStorage.getItem('punzon.brand') || cfg.brand.name;
  document.title = `${brand} · ${cfg.nav.find((n) => n.key === active)?.label || 'Estudio'}`;
  const mark = $('#brandName'); if (mark) mark.textContent = brand;

  const nav = $('#navLinks');
  if (nav) {
    nav.innerHTML = '';
    for (const n of cfg.nav) nav.append(el('a', { href: n.href, class: 'nav-link', 'aria-current': n.key === active ? 'page' : null }, n.label));
  }

  const sb = $('#soundBtn');
  if (sb) {
    const paint = () => { sb.setAttribute('aria-pressed', sound.on); sb.innerHTML = `<span class="dot ${sound.on ? 'on' : ''}"></span>${sound.on ? 'Sonido' : 'Silencio'}`; };
    paint();
    sb.addEventListener('click', () => { sound.on = !sound.on; paint(); if (sound.on) sound.play('commit'); });
  }

  const ib = $('#installBtn');
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; ib?.removeAttribute('hidden'); });
  if (ib) {
    ib.addEventListener('click', async () => {
      if (prompt) { prompt.prompt(); await prompt.userChoice; prompt = null; ib.setAttribute('hidden', ''); }
      else toast('Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».', 'info', 6000);
    });
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  reveal();
  return cfg;
}

export function reveal() {
  const items = $$('[data-reveal]');
  if (!('IntersectionObserver' in window)) { items.forEach((i) => i.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
  items.forEach((i, k) => { i.style.setProperty('--d', `${Math.min(k, 8) * 55}ms`); io.observe(i); });
}

/* ---------- avisos ---------- */
export function toast(msg, kind = 'info', ms = 3600, action) {
  let host = $('#toasts');
  if (!host) { host = el('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = el('div', { class: `toast ${kind}` }, el('span', { class: 't-icon' }, { info: 'i', ok: '✓', warn: '!', error: '×' }[kind] || 'i'), el('span', { class: 't-msg' }, msg));
  if (action) t.append(el('button', { class: 't-act', onclick: () => { action.run(); t.remove(); } }, action.label));
  t.append(el('button', { class: 't-close', 'aria-label': 'Cerrar', onclick: () => t.remove() }, '×'));
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  sound.play(kind === 'error' ? 'error' : kind === 'ok' ? 'done' : 'tick');
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 320); }, ms);
  return t;
}

/* ---------- cajón lateral ---------- */
let drawerCount = 0;
const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export function drawer(title, build, opts = {}) {
  const lastFocus = document.activeElement;
  const scrim = el('div', { class: 'scrim' });
  const panel = el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const body = el('div', { class: 'drawer-body' });
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.remove('in');
    panel.classList.remove('in');
    setTimeout(() => { scrim.remove(); panel.remove(); }, 280);
    drawerCount = Math.max(0, drawerCount - 1);
    if (!drawerCount) document.body.style.overflow = '';
    if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') lastFocus.focus();
    opts.onClose?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  const head = el('header', { class: 'drawer-head' },
    el('h2', {}, title),
    el('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: close }, '×')
  );
  panel.append(head, body);

  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim, panel);
  drawerCount++;
  document.body.style.overflow = 'hidden';

  build(body, close);

  requestAnimationFrame(() => { scrim.classList.add('in'); panel.classList.add('in'); });
  const target = panel.querySelector(FOCUSABLE);
  if (target) target.focus();
  return { close, body, panel };
}

export function confirmDialog(title, message, okLabel = 'Confirmar') {
  return new Promise((res) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; res(v); } };
    drawer(title, (body, close) => {
      body.append(el('p', { class: 'lead' }, message));
      body.append(el('div', { class: 'row end' },
        el('button', { class: 'btn', onclick: () => { finish(false); close(); } }, 'Cancelar'),
        el('button', { class: 'btn danger', onclick: () => { finish(true); close(); } }, okLabel)
      ));
    }, { onClose: () => finish(false) });
  });
}

/* ---------- fábrica de controles JSON → UI ---------- */
export function ctrl(spec, value, onInput) {
  const id = `c_${spec.id}_${Math.random().toString(36).slice(2, 6)}`;
  const wrap = el('div', { class: `ctrl ${spec.type}` });
  const out = el('output', { class: 'ctrl-val', for: id });
  const label = el('label', { for: id }, spec.label);
  let input;
  const show = (v) => {
    out.textContent = spec.type === 'toggle'
      ? (v ? 'Sí' : 'No')
      : spec.type === 'select'
        ? (spec.options.find((o) => (o.id ?? o) === v)?.label ?? v)
        : `${typeof v === 'number' ? Math.round(v * 100) / 100 : v}${spec.unit || ''}`;
  };
  if (spec.type === 'toggle') {
    input = el('input', { type: 'checkbox', id, role: 'switch' });
    input.checked = !!value;
    wrap.classList.add('switch');
    input.addEventListener('change', () => { show(input.checked); onInput(input.checked); });
  } else if (spec.type === 'select') {
    input = el('select', { id });
    for (const o of spec.options) input.append(el('option', { value: o.id ?? o }, o.label ?? o));
    input.value = value;
    input.addEventListener('change', () => { show(input.value); onInput(input.value); });
  } else if (spec.type === 'color') {
    input = el('input', { type: 'color', id });
    input.value = value;
    input.addEventListener('input', () => { show(input.value); onInput(input.value); });
  } else {
    input = el('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step ?? 1 });
    input.value = value;
    const paint = () => input.style.setProperty('--p', `${((input.value - spec.min) / (spec.max - spec.min)) * 100}%`);
    paint();
    input.addEventListener('input', () => { paint(); const v = parseFloat(input.value); show(v); onInput(v); });
  }
  show(value);
  wrap.append(el('div', { class: 'ctrl-top' }, label, out), input);
  if (spec.hint) wrap.append(el('small', { class: 'ctrl-hint' }, spec.hint));
  return Object.assign(wrap, {
    input,
    set: (v) => { if (spec.type === 'toggle') input.checked = !!v; else input.value = v; input.dispatchEvent(new Event('input')); show(v); }
  });
}

export function group(title, ...kids) {
  return el('section', { class: 'ctrl-group' }, el('h3', { class: 'ctrl-title' }, title), ...kids.flat());
}

/* ---------- descarga y portapapeles ---------- */
export function download(data, filename, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  sound.play('done');
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado al portapapeles.', 'ok'); }
  catch { toast('No se pudo copiar. Selecciona el texto manualmente.', 'warn'); }
}

export function fileToText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
}
export const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'punzon';
