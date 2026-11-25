import { $, $$, el, initShell, ctrl, group, toast, download, debounce, slug } from '../ui.js';
import { loadImage, trace, tracePreviewSVG, uid } from '../core/vector.js';
import { contoursToD, contoursBBox } from '../core/path.js';
import * as PR from '../core/project.js';

const S = {
  img: null, project: null, key: 'A', contours: [], sent: false,
  opts: { threshold: 128, invert: false, despeckle: 12, simplify: 1.6, smooth: .5, height: 700, dx: 0, dy: 0, width: 600, flipX: false }
};
const params = new URLSearchParams(location.search);

(async function boot() {
  await initShell('trazo');
  const wanted = params.get('project');
  S.project = wanted
    ? PR.normalize((await PR.store.get(wanted)) || await PR.currentProject())
    : await PR.currentProject();
  S.key = params.get('glyph') || 'A';
  if (!S.project.glyphs[S.key]) {
    S.project.glyphs[S.key] = PR.emptyGlyph(S.key);
    S.project.order.push(S.key);
  }
  const g = S.project.glyphs[S.key];
  S.opts.height = S.project.metrics.capHeight;
  S.opts.width = g.advance;
  $('#projPill').textContent = `${S.project.meta.family} → «${S.key}»`;
  $('#targetInfo').textContent = `Destino: glifo «${S.key}» de ${S.project.meta.family}. Se insertará como contornos rellenables, escalados a ${S.opts.height} unidades.`;
  buildControls();
  bind();
  if (params.get('handoff')) {
    const h = await PR.store.kvGet('handoff');
    if (h?.buf) {
      await useFile(new File([h.buf], h.name, { type: h.type }));
      await PR.store.kvSet('handoff', null);
    } else demo();
  } else demo();
})();

function buildControls() {
  const host = $('#controls'); host.innerHTML = '';
  host.append(
    group('Binarización',
      ctrl({ id: 'threshold', label: 'Umbral', type: 'range', min: 8, max: 250, step: 1 }, S.opts.threshold, (v) => set('threshold', v)),
      ctrl({ id: 'invert', label: 'Invertir', type: 'toggle', hint: 'Actívalo si el trazo es claro sobre fondo oscuro.' }, S.opts.invert, (v) => set('invert', v)),
      ctrl({ id: 'despeckle', label: 'Eliminar motas', type: 'range', min: 0, max: 300, step: 2, unit: ' px²' }, S.opts.despeckle, (v) => set('despeckle', v))
    ),
    group('Contorno',
      ctrl({ id: 'simplify', label: 'Simplificar', type: 'range', min: .2, max: 8, step: .1, unit: ' px' }, S.opts.simplify, (v) => set('simplify', v)),
      ctrl({ id: 'smooth', label: 'Redondear esquinas', type: 'range', min: 0, max: 1, step: .05 }, S.opts.smooth, (v) => set('smooth', v))
    ),
    group('Encaje tipográfico',
      ctrl({ id: 'height', label: 'Altura del glifo', type: 'range', min: 120, max: 1200, step: 10, unit: ' u' }, S.opts.height, (v) => set('height', v)),
      ctrl({ id: 'width', label: 'Ancho del glifo', type: 'range', min: 100, max: 1600, step: 10, unit: ' u' }, S.opts.width, (v) => set('width', v)),
      ctrl({ id: 'dx', label: 'Desplazar X', type: 'range', min: -300, max: 300, step: 2, unit: ' u' }, S.opts.dx, (v) => set('dx', v)),
      ctrl({ id: 'dy', label: 'Desplazar Y', type: 'range', min: -300, max: 300, step: 2, unit: ' u' }, S.opts.dy, (v) => set('dy', v)),
      ctrl({ id: 'flipX', label: 'Espejo horizontal', type: 'toggle' }, S.opts.flipX, (v) => set('flipX', v))
    ),
    group('Acciones',
      el('div', { class: 'row' },
        el('button', {
          class: 'btn sm', onclick: () => {
            Object.assign(S.opts, { threshold: 128, invert: false, despeckle: 12, simplify: 1.6, smooth: .5, dx: 0, dy: 0, flipX: false, height: S.project.metrics.capHeight, width: S.project.glyphs[S.key].advance });
            buildControls(); run();
          }
        }, 'Reiniciar'),
        el('button', {
          class: 'btn sm', onclick: () => {
            Object.assign(S.opts, { threshold: 60 + Math.round(Math.random() * 140), despeckle: Math.round(Math.random() * 80), simplify: .4 + Math.random() * 4, smooth: Math.random() });
            buildControls(); run();
          }
        }, 'Aleatorio')
      ),
      el('p', { class: 'tiny muted', style: 'margin-top:8px' }, 'Sube el umbral si el trazo se corta, y «Eliminar motas» si aparecen islas de ruido.')
    )
  );
}
const set = (k, v) => { S.opts[k] = v; run(); };

function bind() {
  const dz = $('#dropzone'), fi = $('#fileInput');
  dz.onclick = () => fi.click();
  dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } };
  fi.onchange = (e) => { const f = e.target.files[0]; if (f) useFile(f); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('on'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) useFile(f); });

  const presets = {
    tinta: { threshold: 140, despeckle: 20, simplify: 1.2, smooth: .55 },
    lapiz: { threshold: 175, despeckle: 40, simplify: 2.2, smooth: .7 },
    grueso: { threshold: 120, despeckle: 90, simplify: 3, smooth: .8 },
    fino: { threshold: 165, despeckle: 6, simplify: .7, smooth: .3 }
  };
  $$('[data-preset]').forEach((b) => b.onclick = () => {
    Object.assign(S.opts, presets[b.dataset.preset]);
    buildControls(); run();
    toast(`Preset «${b.textContent}» aplicado.`, 'ok');
  });

  $('#demoBtn').onclick = demo;
  $('#sendBtn').onclick = send;
  $('#svgBtn').onclick = () => {
    if (!S.contours.length) return;
    const bb = contoursBBox(S.contours);
    download(tracePreviewSVG(S.contours, { x: bb.x0 - 40, y: bb.y0 - 40, w: bb.w + 80, h: bb.h + 80 }),
      `${slug(S.project.meta.family)}-${S.project.glyphs[S.key].name}-trazo.svg`, 'image/svg+xml');
  };
}

async function useFile(file) {
  if (!/^image\//.test(file.type)) return toast('Elige una imagen PNG, JPG o WebP.', 'warn');
  try {
    S.img = await loadImage(file, 720);
    paintSource(); run();
    toast(`Imagen cargada: ${S.img.origW}×${S.img.origH} → ${S.img.w}×${S.img.h} de trabajo.`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

function paintSource() {
  const cv = $('#srcView');
  cv.width = S.img.w; cv.height = S.img.h;
  cv.getContext('2d').putImageData(S.img.data, 0, 0);
}

function demo() {
  const cv = document.createElement('canvas');
  cv.width = 460; cv.height = 560;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, 460, 560);
  c.strokeStyle = '#111'; c.lineWidth = 52; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(90, 500); c.lineTo(230, 80); c.lineTo(370, 500); c.stroke();
  c.beginPath(); c.moveTo(140, 360); c.lineTo(320, 360); c.stroke();
  cv.toBlob(async (b) => {
    if (!b) return toast('No se pudo generar la muestra.', 'error');
    S.img = await loadImage(new File([b], 'muestra.png', { type: 'image/png' }), 720);
    paintSource(); run();
  }, 'image/png');
}

const run = debounce(() => {
  if (!S.img) return;
  const t0 = performance.now();
  const res = trace(S.img, S.opts);
  S.contours = res.contours;
  const bb = contoursBBox(res.contours);
  const box = res.contours.length
    ? { x: bb.x0 - 60, y: bb.y0 - 60, w: bb.w + 120, h: bb.h + 120 }
    : { x: 0, y: 0, w: S.opts.width, h: S.opts.height };
  $('#vecView').innerHTML = res.contours.length
    ? tracePreviewSVG(res.contours, box)
    : '<p class="tiny muted" style="padding:20px;text-align:center">Ningún contorno con estos ajustes.<br>Sube el umbral o baja «Eliminar motas».</p>';
  $('#cCount').textContent = res.count;
  $('#pCount').textContent = res.points;
  $('#sendBtn').disabled = !res.contours.length;
  $('#svgBtn').disabled = !res.contours.length;
  $('#targetInfo').textContent = `Destino: «${S.key}» de ${S.project.meta.family} · ${res.count} contornos, ${res.points} puntos en ${Math.round(performance.now() - t0)} ms.`;
}, 90);

async function send() {
  if (!S.contours.length) return;
  const g = S.project.glyphs[S.key];
  const prev = JSON.stringify(g.objects);
  const prevAdvance = g.advance;
  g.objects.push({ id: uid(), type: 'path', d: contoursToD(S.contours), mode: 'nest', visible: true });
  g.advance = Math.round(S.opts.width);
  g.modified = Date.now();
  await PR.store.put(S.project);
  await PR.setCurrent(S.project.id);

  toast(`Contornos enviados al glifo «${S.key}».`, 'ok', 9000, {
    label: 'Deshacer',
    run: async () => {
      g.objects = JSON.parse(prev);
      g.advance = prevAdvance;
      await PR.store.put(S.project);
      toast('Inserción revertida.', 'info');
    }
  });

  if (!S.sent) {
    S.sent = true;
    const back = el('button', { class: 'btn steel block', onclick: () => location.href = 'index.html' }, 'Volver al editor');
    $('#sendBtn').parentElement.append(back);
  }
  $('#targetInfo').textContent = `Enviado a «${S.key}». Puedes seguir afinando y volver a enviar, o deshacer desde el aviso.`;
                   }
