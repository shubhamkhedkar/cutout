// Web Worker: edge-preserving denoise (bilateral) + unsharp mask on RGBA pixels
function bilateral(src, w, h, strength) {
  if (strength <= 0) return src;
  const r = strength > 0.6 ? 3 : 2, sigS = r * 0.75, sigR = 8 + strength * 40;
  const out = new Uint8ClampedArray(src.length);
  const sw = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sw.push(Math.exp(-(dx*dx+dy*dy)/(2*sigS*sigS)));
  const rw = new Float32Array(766); for (let i = 0; i < 766; i++) rw[i] = Math.exp(-(i*i)/(2*sigR*sigR*3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y*w+x)*4, R = src[i], G = src[i+1], B = src[i+2];
    let sr = 0, sg = 0, sb = 0, ws = 0, k = 0;
    for (let dy = -r; dy <= r; dy++) { const yy = Math.min(h-1, Math.max(0, y+dy));
      for (let dx = -r; dx <= r; dx++, k++) { const xx = Math.min(w-1, Math.max(0, x+dx)), j = (yy*w+xx)*4;
        const d = Math.abs(src[j]-R)+Math.abs(src[j+1]-G)+Math.abs(src[j+2]-B);
        const wt = sw[k]*rw[d]; sr += src[j]*wt; sg += src[j+1]*wt; sb += src[j+2]*wt; ws += wt; } }
    out[i] = sr/ws; out[i+1] = sg/ws; out[i+2] = sb/ws; out[i+3] = src[i+3];
  }
  return out;
}
function boxBlur(ch, w, h, r) { // separable box blur, 3 passes ≈ gaussian
  let a = Float32Array.from(ch); const b = new Float32Array(ch.length), d = 2*r+1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { const o = y*w; let s = 0;
      for (let x = -r; x <= r; x++) s += a[o+Math.min(w-1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { b[o+x] = s/d; s += a[o+Math.min(w-1, x+r+1)] - a[o+Math.max(0, x-r)]; } }
    for (let x = 0; x < w; x++) { let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(h-1, Math.max(0, y))*w+x];
      for (let y = 0; y < h; y++) { a[y*w+x] = s/d; s += b[Math.min(h-1, y+r+1)*w+x] - b[Math.max(0, y-r)*w+x]; } }
  }
  return a;
}
function unsharp(src, w, h, amount) {
  if (amount <= 0) return src;
  const n = w*h, L = new Float32Array(n);
  for (let p = 0; p < n; p++) L[p] = 0.299*src[p*4] + 0.587*src[p*4+1] + 0.114*src[p*4+2];
  const Lb = boxBlur(L, w, h, 1), out = new Uint8ClampedArray(src.length), thr = 2;
  for (let p = 0; p < n; p++) { let d = L[p]-Lb[p]; if (Math.abs(d) < thr) d = 0; d *= amount*1.5;
    out[p*4] = src[p*4]+d; out[p*4+1] = src[p*4+1]+d; out[p*4+2] = src[p*4+2]+d; out[p*4+3] = src[p*4+3]; }
  return out;
}
self.onmessage = ({ data }) => {
  const { id, pixels, width, height, denoise, sharpen } = data;
  let px = new Uint8ClampedArray(pixels);
  px = bilateral(px, width, height, denoise);
  px = unsharp(px, width, height, sharpen);
  self.postMessage({ id, pixels: px, width, height }, [px.buffer]);
};
