import { createWorker, PSM } from "tesseract.js";

/* ------------------------------------------------------------------
   OCR fallback: reads the printed student number off an ID when its
   barcode won't scan (glare, scratches, a worn card).

   Runs Tesseract in a Web Worker, entirely on the laptop. The worker,
   the WebAssembly engine and the English model are copied into the
   build from node_modules (see vite.config.js), so it works with no
   internet connection at the venue.

   Returns the digits it read plus Tesseract's confidence for each one.
   Those per-digit confidences are evidence for the matcher on the
   server (server/matcher.js), which decides who the attendee is.
------------------------------------------------------------------- */

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        workerBlobURL: false,
      });
      await w.setParameters({
        tessedit_char_whitelist: "0123456789-",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Start loading the OCR engine in the background, so the first read isn't slow. */
export function warmUpOcr() {
  getWorker().catch(() => {});
}

// Same region as the on-screen frame (.frame in shared.jsx): left/right 18%, top/bottom 16%
const ROI = { left: 0.18, top: 0.16, width: 0.64, height: 0.68 };
const TARGET_WIDTH = 1400; // Tesseract likes larger text; upscale small crops

function capture(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const sx = Math.round(vw * ROI.left), sy = Math.round(vh * ROI.top);
  const sw = Math.round(vw * ROI.width), sh = Math.round(vh * ROI.height);
  const scale = Math.max(1, TARGET_WIDTH / sw);
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/* Preprocessing. Up to three versions of the frame are read and the best result kept:
   - "stretched": grayscale with the contrast stretched between the 2nd and
     98th percentile, so a dim card uses the full range
   - "flattened": glare correction. A pixel counts as ink when it is a few
     percent darker than the average of the card around it. Glare lifts the
     ink and the card around it together, so faded digits in a hotspot
     still come out black (a local, adaptive threshold)
   - "binary": the stretched image thresholded with Otsu's method */
function otsu(values) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const n = values.length;
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = v; }
  }
  return thr;
}

/** Mean of each pixel's (2r+1) x (2r+1) neighbourhood, via an integral image. */
function boxBlur(gray, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function preprocess(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const n = px.length / 4;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
    gray[i] = g;
    hist[gray[i]]++;
  }
  const pctl = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  const lo = pctl(0.02), hi = Math.max(lo + 1, pctl(0.98));
  const stretched = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) stretched[i] = ((gray[i] - lo) * 255) / (hi - lo);
  const thr = otsu(stretched);

  // Glare correction: compare each pixel with the average brightness around it
  const w = canvas.width, h = canvas.height;
  const bg = boxBlur(gray, w, h, Math.round(w / 25));
  const INK = 0.96; // at least 4% darker than its surroundings

  const make = (fn) => {
    const c = document.createElement("canvas");
    c.width = canvas.width; c.height = canvas.height;
    const out = c.getContext("2d").createImageData(c.width, c.height);
    for (let i = 0; i < n; i++) { const v = fn(i); out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
    c.getContext("2d").putImageData(out, 0, 0);
    return c;
  };
  return [
    ["stretched", make((i) => stretched[i])],
    ["flattened", make((i) => (gray[i] < bg[i] * INK ? 0 : 255))],
    ["binary", make((i) => (stretched[i] > thr ? 255 : 0))],
  ];
}

/* From everything Tesseract found, pick what is most likely the student
   number: a run of about nine digits, ideally shaped like YYYY-NNNNN,
   possibly split into two words at the hyphen. */
function pickNumber(blocks) {
  const lines = [];
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push(l.words || []);

  let best = null;
  const consider = (words) => {
    const syms = words.flatMap((w) => w.symbols || []);
    const digits = syms.filter((s) => /^\d$/.test(s.text));
    // A partial read (some digits lost to glare) is still useful: the matcher handles missing digits
    if (digits.length < 6 || digits.length > 11) return;
    const text = syms.map((s) => s.text).join("");
    const conf = digits.map((s) => Math.max(0, Math.min(1, s.confidence / 100)));
    const mean = conf.reduce((a, c) => a + c, 0) / conf.length;
    let score = mean - 0.15 * Math.abs(9 - digits.length);
    if (digits.length === 9) score += 0.5;
    if (/^(19|20)\d\d-?\d{5}$/.test(text)) score += 0.5;
    if (!best || score > best.score) best = { score, read: digits.map((s) => s.text).join(""), conf, mean, text };
  };
  for (const words of lines) {
    for (let i = 0; i < words.length; i++) {
      consider([words[i]]);
      if (i + 1 < words.length) consider([words[i], words[i + 1]]);
    }
  }
  return best;
}

/**
 * Reads the student number from the current camera frame.
 * Resolves to { read: "202341587", conf: [0.97, ...], meanConf, text, variant, ms } or null.
 */
export async function readStudentNumber(video) {
  const t0 = performance.now();
  const frame = capture(video);
  if (!frame) return null;
  const worker = await getWorker();
  let best = null;
  for (const [variant, canvas] of preprocess(frame)) {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const found = pickNumber(data.blocks);
    if (found && (!best || found.score > best.score)) best = { ...found, variant };
    // A clean, confident read on the first pass is good enough
    if (best && best.read.length === 9 && best.mean > 0.9) break;
  }
  if (!best) return null;
  return { read: best.read, conf: best.conf, meanConf: best.mean, text: best.text, variant: best.variant, ms: Math.round(performance.now() - t0) };
}
