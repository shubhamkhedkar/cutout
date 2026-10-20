# ✂️ Cutout

**AI background removal + photo enhancement that runs 100% in your browser.**

🔗 **Live:** https://shubhamkhedkar.github.io/cutout/

## Features
- **Upload** via drag & drop, file picker, or paste (Ctrl/⌘+V)
- **Subject detection & background removal** with [BRIA RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) (soft alpha matte, good on hair)
- **Enhancement** so the result looks clean:
  - edge-preserving **bilateral denoise** (strength slider)
  - luminance **unsharp mask** with noise threshold (strength slider)
  - optional **2× AI upscale** with [Swin2SR](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64) for small images (≤ 512 px)
- **Before/after comparison slider** (drag, or keyboard via range input)
- **Backgrounds:** transparent, white, any solid color, or blurred original
- **Download as PNG** at full working resolution
- Large images are downscaled to max 2048 px to keep memory sane
- Responsive, dark UI with animations; respects `prefers-reduced-motion`; labelled controls

## How it works
| Step | Where | Tech |
|---|---|---|
| Segmentation | Web Worker (`worker.js`) | [transformers.js](https://github.com/huggingface/transformers.js) v3 + ONNX Runtime Web, RMBG-1.4 |
| Super-resolution | Web Worker (`worker.js`) | transformers.js `image-to-image` pipeline, Swin2SR ×2 |
| Denoise + sharpen | Web Worker (`filters.js`) | plain JS bilateral filter + separable gaussian-approx unsharp mask |
| Compositing / export | Main thread | Canvas 2D |

Models are fetched from the Hugging Face Hub on first use (~44 MB for RMBG) and stored in the browser Cache Storage, so later visits are fast and work offline-ish.

No build step: it's static HTML/CSS/JS served by GitHub Pages.

## Privacy
Your images **never leave your device**. All inference and image processing run locally in your browser; the only network requests are for the app files and model weights.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Limitations
- First run downloads the model (~44 MB); processing takes several seconds to ~1 min depending on device (WASM/CPU).
- 2× upscale is CPU-heavy and limited to small images.
- Very complex scenes or multiple subjects may produce imperfect masks.

## License
[MIT](LICENSE) · RMBG-1.4 weights are under BRIA's own non-commercial license — check it before commercial use.
