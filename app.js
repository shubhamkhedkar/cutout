const $ = (id) => document.getElementById(id);
const MAX_SIDE = 2048, SR_MAX_SIDE = 512;
const ai = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const fx = new Worker(new URL('./filters.js', import.meta.url));
const S = { name: 'image', orig: null, mask: null, base: null, enh: null, fxId: 0 };
window.__cutout = S; // exposed for tests

// ---------- input ----------
const drop = $('drop'), file = $('file');
drop.onclick = () => file.click();
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
file.onchange = () => file.files[0] && load(file.files[0]);
['dragenter', 'dragover'].forEach(t => addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
addEventListener('drop', e => { const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/')); f && load(f); });
addEventListener('paste', e => { const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); it && load(it.getAsFile()); });

function status(msg, pct) {
  $('status').hidden = !msg; if (!msg) return;
  $('statusMsg').textContent = msg;
  if (pct != null) { $('barFill').style.width = pct + '%'; $('barFill').parentElement.setAttribute('aria-valuenow', Math.round(pct)); }
}
const ask = (msg, transfer) => new Promise((res, rej) => {
  const want = msg.type === 'mask' ? 'mask' : 'upscaled';
  ai.onmessage = ({ data }) => {
    if (data.type === 'progress') status(`Downloading model: ${data.file} — ${Math.round(data.pct)}%`, data.pct);
    else if (data.type === 'status') status(data.msg);
    else if (data.type === 'error') rej(new Error(data.msg));
    else if (data.type === want) res(data);
  };
  ai.postMessage(msg, transfer);
});

async function load(f) {
  try {
    S.name = (f.name || 'image').replace(/\.[^.]+$/, '');
    drop.hidden = true; $('workspace').hidden = true; status('Reading image…', 0);
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.drawImage(bmp, 0, 0, w, h);
    S.orig = x.getImageData(0, 0, w, h);
    $('info').textContent = k < 1 ? `Large image downscaled from ${bmp.width}×${bmp.height} to ${w}×${h}.` : `${w}×${h}`;
    $('upscale').disabled = Math.max(w, h) > SR_MAX_SIDE; $('upscale').checked = false;
    $('upNote').textContent = $('upscale').disabled ? `Available for images ≤ ${SR_MAX_SIDE}px (this one is larger — already high-res).` : '';
    const px = S.orig.data.slice();
    const r = await ask({ type: 'mask', pixels: px.buffer, width: w, height: h }, [px.buffer]);
    S.mask = new Uint8ClampedArray(r.mask);
    S.base = { pixels: S.orig.data, mask: S.mask, width: w, height: h };
    await enhance();
    status(null); $('workspace').hidden = false; document.body.dataset.ready = '1';
  } catch (e) { console.error(e); status('Error: ' + e.message); drop.hidden = false; }
}

// ---------- upscale ----------
$('upscale').onchange = async () => {
  const { width: w, height: h } = S.orig;
  if (!$('upscale').checked) S.base = { pixels: S.orig.data, mask: S.mask, width: w, height: h };
  else {
    $('workspace').hidden = true;
    try {
      const px = S.orig.data.slice();
      const r = await ask({ type: 'upscale', pixels: px.buffer, width: w, height: h }, [px.buffer]);
      // resize mask to match with smooth interpolation
      const mc = new OffscreenCanvas(w, h), mx = mc.getContext('2d'), md = mx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) { md.data[i * 4 + 3] = S.mask[i]; } mx.putImageData(md, 0, 0);
      const bc = new OffscreenCanvas(r.width, r.height), bx = bc.getContext('2d'); bx.imageSmoothingQuality = 'high';
      bx.drawImage(mc, 0, 0, r.width, r.height); const big = bx.getImageData(0, 0, r.width, r.height).data;
      const m2 = new Uint8ClampedArray(r.width * r.height); for (let i = 0; i < m2.length; i++) m2[i] = big[i * 4 + 3];
      S.base = { pixels: new Uint8ClampedArray(r.pixels), mask: m2, width: r.width, height: r.height };
      $('info').textContent = `Upscaled to ${r.width}×${r.height}.`;
    } catch (e) { console.error(e); $('upscale').checked = false; $('upNote').textContent = 'Upscale failed: ' + e.message; }
    status(null); $('workspace').hidden = false;
  }
  await enhance();
};

// ---------- enhance (denoise + sharpen in worker) ----------
let deb;
for (const id of ['denoise', 'sharpen']) $(id).oninput = () => {
  $(id === 'denoise' ? 'dnOut' : 'shOut').textContent = $(id).value;
  clearTimeout(deb); deb = setTimeout(enhance, 150);
};
function enhance() {
  const b = S.base, id = ++S.fxId;
  return new Promise(res => {
    fx.onmessage = ({ data }) => { if (data.id !== S.fxId) return;
      S.enh = { pixels: data.pixels, width: data.width, height: data.height }; render(); res(); };
    fx.postMessage({ id, pixels: b.pixels.slice(), width: b.width, height: b.height,
      denoise: $('denoise').value / 100, sharpen: $('sharpen').value / 100 });
  });
}

// ---------- compose & render ----------
function cutoutCanvas() {
  const { pixels, width: w, height: h } = S.enh, m = S.base.mask;
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d'), d = new ImageData(new Uint8ClampedArray(pixels), w, h);
  for (let i = 0; i < w * h; i++) d.data[i * 4 + 3] = m[i];
  x.putImageData(d, 0, 0); return c;
}
function compose(target) {
  const { width: w, height: h } = S.enh; target.width = w; target.height = h;
  const x = target.getContext('2d'), bg = document.querySelector('input[name=bg]:checked').value;
  x.clearRect(0, 0, w, h);
  if (bg === 'white' || bg === 'color') { x.fillStyle = bg === 'white' ? '#fff' : $('color').value; x.fillRect(0, 0, w, h); }
  if (bg === 'blur') {
    const full = new OffscreenCanvas(w, h); full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(S.enh.pixels), w, h), 0, 0);
    const r = Math.max(6, Math.round(Math.max(w, h) / 80));
    x.filter = `blur(${r}px)`; x.drawImage(full, -r * 2, -r * 2, w + r * 4, h + r * 4); x.filter = 'none';
  }
  x.drawImage(cutoutCanvas(), 0, 0);
}
function render() {
  compose($('afterCv'));
  const b = $('beforeCv'); b.width = S.enh.width; b.height = S.enh.height;
  const o = new OffscreenCanvas(S.orig.width, S.orig.height); o.getContext('2d').putImageData(S.orig, 0, 0);
  b.getContext('2d').drawImage(o, 0, 0, b.width, b.height);
  $('colorRow').hidden = document.querySelector('input[name=bg]:checked').value !== 'color';
}
document.querySelectorAll('input[name=bg]').forEach(r => r.onchange = render);
$('color').oninput = render;

// ---------- comparison slider ----------
function setCmp(p) { p = Math.max(0, Math.min(100, p)); $('beforeCv').style.clipPath = `inset(0 ${100 - p}% 0 0)`; $('handle').style.left = p + '%'; $('cmp').value = p; }
$('cmp').oninput = () => setCmp(+$('cmp').value);
const stage = $('stage'); let drag = false;
const fromEvt = e => { const r = stage.getBoundingClientRect(); setCmp((e.clientX - r.left) / r.width * 100); };
stage.onpointerdown = e => { drag = true; stage.setPointerCapture(e.pointerId); fromEvt(e); };
stage.onpointermove = e => drag && fromEvt(e);
stage.onpointerup = () => drag = false;

// ---------- actions ----------
$('dl').onclick = () => {
  const c = document.createElement('canvas'); compose(c);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${S.name}-cutout.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
};
$('reset').onclick = () => { $('workspace').hidden = true; drop.hidden = false; file.value = ''; delete document.body.dataset.ready; };
