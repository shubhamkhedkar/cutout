// Web Worker: background removal (RMBG-1.4) + optional 2x super-resolution (Swin2SR) via transformers.js
import { env, AutoModel, AutoProcessor, RawImage, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
env.allowLocalModels = false;
env.useBrowserCache = true;

let seg = null, proc = null, sr = null;
const post = (type, data = {}) => self.postMessage({ type, ...data });
const progress = (stage) => (p) => { if (p.status === 'progress') post('progress', { stage, file: p.file, pct: p.progress }); };

async function loadSeg() {
  if (seg) return;
  post('status', { msg: 'Downloading background-removal model (~44 MB, cached after first use)…' });
  seg = await AutoModel.from_pretrained('briaai/RMBG-1.4', { config: { model_type: 'custom' }, dtype: 'fp32', progress_callback: progress('seg') });
  proc = await AutoProcessor.from_pretrained('briaai/RMBG-1.4', { config: {
    do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
    image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1], feature_extractor_type: 'ImageFeatureExtractor',
    resample: 2, rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 } } });
}
async function loadSR() {
  if (sr) return;
  post('status', { msg: 'Downloading super-resolution model (cached after first use)…' });
  sr = await pipeline('image-to-image', 'Xenova/swin2SR-classical-sr-x2-64', { dtype: 'fp32', progress_callback: progress('sr') });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'mask') {
      await loadSeg();
      post('status', { msg: 'Detecting subject…' });
      const img = new RawImage(new Uint8ClampedArray(data.pixels), data.width, data.height, 4);
      const { pixel_values } = await proc(img.rgb());
      const { output } = await seg({ input: pixel_values });
      const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(data.width, data.height);
      post('mask', { mask: mask.data, width: data.width, height: data.height });
    } else if (data.type === 'upscale') {
      await loadSR();
      post('status', { msg: 'Upscaling 2× with Swin2SR…' });
      const img = new RawImage(new Uint8ClampedArray(data.pixels), data.width, data.height, 4).rgb();
      const out = await sr(img);
      // Swin2SR pads input to a multiple of 8 — crop back to exactly 2x
      const W = data.width * 2, H = data.height * 2, src = out.rgba().data, px = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) px.set(src.subarray(y * out.width * 4, (y * out.width + W) * 4), y * W * 4);
      post('upscaled', { pixels: px, width: W, height: H });
    }
  } catch (e) { post('error', { msg: String(e && e.message || e) }); }
};
