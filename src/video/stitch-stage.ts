// <media-stitch>: the picture, re-stitched as a cross-stitch sampler.
//
// Before the first play the poster is a finished sampler on oatmeal aida cloth. Pressing play unpicks it, row by row,
// to reveal the film. Whenever playback pauses or ends, a needle stitches the frozen frame back in, one cross at a
// time, in real thread colours. Resuming unpicks it again.
//
// Each cell of a grid samples the picture, snaps to the nearest of 36 thread colours, and becomes an X made of two
// shaded stitches. Cells that are close to the cloth are left bare, as a stitcher would. The cloth and its holes come
// from CSS tokens (--sm-cloth, --sm-hole), so every colourway restyles it.
//
// The canvas loop runs only while a needle is moving (about a second) and never while the page is hidden. If the browser
// will not let the page read the picture (media without CORS headers), an empty sampler cloth is shown instead.

const STITCH_MS = 1150;
const UNPICK_MS = 520;

// A spread of embroidery floss colours, enough for skin, sky, foliage, metal and shadow.
const PALETTE = [
  '#f4efe3', '#d8d2c4', '#a9a69c', '#6f6e69', '#3d3d3d', '#17171a',
  '#b3242b', '#e0503a', '#f19a8b', '#7a1f2b',
  '#f08a24', '#f6c445', '#fbe9a0', '#b9761f',
  '#2f7d3b', '#67b36a', '#b6d98a', '#1f4d3a',
  '#0f6f7a', '#3aa5b5', '#1f3f8f', '#4b78c8', '#9cc0e8', '#162a5c',
  '#6b3b8f', '#b078c8', '#d94f8b', '#f3b3cf',
  '#5a3a22', '#8b5a34', '#c28a56', '#e3b88e', '#f1d3b3', '#a85a44',
  '#c9d6df', '#5d6b78',
];

const RGB = PALETTE.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
const LIGHT = PALETTE.map((hex) => mix(hex, '#ffffff', 0.32));

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = (i: number) => Math.round(p(a, i) * (1 - t) + p(b, i) * t);
  return `rgb(${c(0)} ${c(1)} ${c(2)})`;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Finds the playing <video>, including inside a media element's shadow root. */
export function findVideo(root: ParentNode | null): HTMLVideoElement | null {
  if (!root) return null;

  const direct = root.querySelector('video');
  if (direct) return direct;

  for (const el of root.querySelectorAll('*')) {
    const inner = el.shadowRoot?.querySelector('video');
    if (inner) return inner;
  }

  return null;
}

function nearest(r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < RGB.length; i++) {
    const dr = r - RGB[i][0];
    const dg = g - RGB[i][1];
    const db = b - RGB[i][2];
    // Weighted so the eye's sensitivity to green and red is respected.
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

export class MediaStitch extends HTMLElement {
  #canvas = document.createElement('canvas');
  #ctx = this.#canvas.getContext('2d')!;
  #sampler = document.createElement('canvas');
  #samplerCtx = this.#sampler.getContext('2d', { willReadFrequently: true })!;

  #container: HTMLElement | null = null;
  #video: HTMLVideoElement | null = null;
  #poster: HTMLImageElement | null = null;
  #posterUrl = '';
  #watchers: MutationObserver[] = [];
  #resize: ResizeObserver | null = null;
  #motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  #cols = 0;
  #rows = 0;
  #pitch = 10;
  /** Palette index per cell, or 255 for a bare cell. Stored in stitching order, not grid order. */
  #order: { x: number; y: number; c: number }[] = [];
  #cloth = '#ebe2cd';
  #hole = '#8a7d62';

  #progress = 0;
  #target = 0;
  #span = UNPICK_MS;
  #wasStarted = false;
  #raf = 0;
  #retry = 0;
  #lastTick = 0;

  connectedCallback() {
    this.setAttribute('aria-hidden', 'true');
    this.#canvas.className = 'stitch-canvas';
    this.append(this.#canvas);

    this.#container = this.closest<HTMLElement>('.media-skin');
    if (!this.#container) return;

    const play = this.#container.querySelector('media-play-button');
    if (play) {
      const watcher = new MutationObserver(() => this.#sync());
      watcher.observe(play, { attributes: true, attributeFilter: ['data-paused', 'data-started', 'data-ended'] });
      this.#watchers.push(watcher);
    }

    const theme = new MutationObserver(() => {
      this.#readTokens();
      this.#paint();
    });
    theme.observe(this.#container, { attributes: true, attributeFilter: ['data-sampler-theme', 'style'] });
    this.#watchers.push(theme);

    const poster = this.#container.querySelector('media-poster');
    if (poster) {
      const watcher = new MutationObserver(() => this.#loadPoster());
      watcher.observe(poster, { attributes: true, subtree: true, attributeFilter: ['src', 'data-visible'] });
      this.#watchers.push(watcher);
    }

    this.#resize = new ResizeObserver(() => this.#layout());
    this.#resize.observe(this.#container);

    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#readTokens();
    this.#layout();
    this.#loadPoster();
    this.#sync();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    clearTimeout(this.#retry);
    this.#watchers.forEach((watcher) => watcher.disconnect());
    this.#watchers = [];
    this.#resize?.disconnect();
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#unbindVideo();
  }

  #readTokens() {
    if (!this.#container) return;
    const style = getComputedStyle(this.#container);
    this.#cloth = style.getPropertyValue('--sm-cloth').trim() || '#ebe2cd';
    this.#hole = style.getPropertyValue('--sm-hole').trim() || '#8a7d62';
  }

  #onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
      this.#progress = this.#target;
      this.#paint();
    }
  };

  #loadPoster() {
    const img = this.#container?.querySelector<HTMLImageElement>('media-poster img');
    const url = img?.currentSrc || img?.src || this.closest('video-player')?.getAttribute('poster') || '';
    if (!url || url === this.#posterUrl) return;

    this.#posterUrl = url;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      this.#poster = image;
      if (this.#target === 1 && !this.#wasStarted) this.#sampleWhenReady();
    };
    image.onerror = () => {
      this.#poster = null;
    };
    image.src = url;
  }

  #bindVideo(): HTMLVideoElement | null {
    const video = findVideo(this.#container);
    if (video === this.#video) return video;

    this.#unbindVideo();
    this.#video = video;
    for (const type of ['seeked', 'loadeddata', 'canplay']) video?.addEventListener(type, this.#onFrameChange);
    return video;
  }

  #unbindVideo() {
    for (const type of ['seeked', 'loadeddata', 'canplay']) this.#video?.removeEventListener(type, this.#onFrameChange);
    this.#video = null;
  }

  // Scrubbing while paused lands on a new frame, so it is stitched again at once.
  #onFrameChange = () => {
    if (this.#target === 1 && this.#wasStarted) {
      this.#sampleWhenReady();
      this.#progress = 1;
      this.#paint();
    }
  };

  #sync() {
    const play = this.#container?.querySelector('media-play-button');
    if (!play) return;

    const started = play.hasAttribute('data-started');
    const showing = !started || play.hasAttribute('data-paused') || play.hasAttribute('data-ended');
    const next = showing ? 1 : 0;
    this.#wasStarted = started;

    if (next === this.#target) return;

    this.#target = next;
    this.#span = next === 1 ? STITCH_MS : UNPICK_MS;
    this.#container?.toggleAttribute('data-stitched', showing);

    if (showing) {
      this.#bindVideo();
      this.#sampleWhenReady();
    }

    if (this.#motion.matches || document.hidden) {
      this.#progress = next;
      this.#paint();
      return;
    }

    this.#lastTick = performance.now();
    cancelAnimationFrame(this.#raf);
    this.#raf = requestAnimationFrame(this.#tick);
  }

  // A seek or a stalled decode can leave the frame unreadable at the instant of pausing, so try again briefly.
  #sampleWhenReady(attempt = 0) {
    clearTimeout(this.#retry);
    if (this.#sample() || attempt >= 12 || this.#target !== 1) {
      this.#paint();
      return;
    }
    this.#retry = window.setTimeout(() => this.#sampleWhenReady(attempt + 1), 160);
  }

  #layout() {
    const box = this.#container?.getBoundingClientRect();
    if (!box || box.width === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#canvas.width = Math.round(box.width * dpr);
    this.#canvas.height = Math.round(box.height * dpr);
    this.#pitch = Math.min(15, Math.max(8, Math.round(box.width / 66)));
    this.#cols = Math.ceil(box.width / this.#pitch);
    this.#rows = Math.ceil(box.height / this.#pitch);
    this.#sampler.width = this.#cols;
    this.#sampler.height = this.#rows;

    if (this.#target === 1) this.#sampleWhenReady();
    else this.#paint();
  }

  // Reads the current picture (the poster before play, the frame after) into stitches, in the order a needle would
  // make them: left to right on one row, right to left on the next. Returns false when there is nothing to read yet.
  #sample(): boolean {
    const cols = this.#cols;
    const rows = this.#rows;
    if (!cols || !rows) return false;

    const video = this.#bindVideo();
    const useVideo = this.#wasStarted;
    const source: CanvasImageSource | null = useVideo ? video : this.#poster;
    const sw = useVideo ? (video?.videoWidth ?? 0) : (this.#poster?.naturalWidth ?? 0);
    const sh = useVideo ? (video?.videoHeight ?? 0) : (this.#poster?.naturalHeight ?? 0);

    this.#order = [];
    if (!source || !sw || (useVideo && (video?.readyState ?? 0) < 2)) return false;

    const fit = Math.min(cols / sw, rows / sh);
    const w = sw * fit;
    const h = sh * fit;
    const x0 = (cols - w) / 2;
    const y0 = (rows - h) / 2;

    try {
      this.#samplerCtx.clearRect(0, 0, cols, rows);
      this.#samplerCtx.drawImage(source, x0, y0, w, h);
      const { data } = this.#samplerCtx.getImageData(0, 0, cols, rows);

      // Compare against the cloth so near-cloth cells stay bare.
      const clothRgb = hexToRgb(this.#cloth);

      for (let cy = 0; cy < rows; cy++) {
        for (let k = 0; k < cols; k++) {
          const cx = cy % 2 === 0 ? k : cols - 1 - k;
          const o = (cy * cols + cx) * 4;
          if (data[o + 3] < 200) continue;

          // A touch more saturation, since thread reads duller than light.
          const mean = (data[o] + data[o + 1] + data[o + 2]) / 3;
          const boost = (v: number) => Math.min(255, Math.max(0, (mean + (v - mean) * 1.45 - 128) * 1.18 + 128));
          const r = boost(data[o]);
          const g = boost(data[o + 1]);
          const b = boost(data[o + 2]);

          const dr = r - clothRgb[0];
          const dg = g - clothRgb[1];
          const db = b - clothRgb[2];
          if (dr * dr + dg * dg + db * db < 900) continue;

          this.#order.push({ x: cx, y: cy, c: nearest(r, g, b) });
        }
      }
      return this.#order.length > 0;
    } catch {
      // The picture is cross-origin and cannot be read: show the empty sampler cloth.
      return true;
    }
  }

  #tick = (now: number) => {
    const elapsed = now - this.#lastTick;
    this.#lastTick = now;

    const step = elapsed / this.#span;
    this.#progress = this.#target === 1 ? Math.min(1, this.#progress + step) : Math.max(0, this.#progress - step);
    this.#paint();

    if (this.#progress !== this.#target && !document.hidden) {
      this.#raf = requestAnimationFrame(this.#tick);
    } else {
      this.#raf = 0;
      this.#progress = this.#target;
      this.#paint();
    }
  };

  #paint() {
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, width, height);

    const progress = this.#progress;
    if (progress <= 0 || !this.#cols) return;

    const dpr = width / Math.max(1, this.#cols * this.#pitch);
    const pitch = this.#pitch * dpr;

    // Cloth: opaque, with the small holes of aida weave at every cell corner. It fades in so it never snaps.
    ctx.globalAlpha = Math.min(1, progress * 6);
    ctx.fillStyle = this.#cloth;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = this.#hole;
    ctx.globalAlpha *= 0.5;
    ctx.beginPath();
    const holeR = Math.max(0.6, pitch * 0.075);
    for (let gy = 0; gy <= this.#rows; gy++) {
      for (let gx = 0; gx <= this.#cols; gx++) {
        ctx.moveTo(gx * pitch + holeR, gy * pitch);
        ctx.arc(gx * pitch, gy * pitch, holeR, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    const total = this.#order.length;
    const done = ease(progress) * total;
    const whole = Math.floor(done);

    // Batch the strokes by thread colour: one path and one stroke call per colour, not one per stitch.
    const under: Path2D[] = [];
    const over: Path2D[] = [];
    const sheen: Path2D[] = [];
    const inset = pitch * 0.16;

    for (let n = 0; n < whole; n++) {
      const { x, y, c } = this.#order[n];
      const left = x * pitch + inset;
      const top = y * pitch + inset;
      const right = (x + 1) * pitch - inset;
      const bottom = (y + 1) * pitch - inset;

      (under[c] ??= new Path2D()).moveTo(left, bottom);
      under[c].lineTo(right, top);
      (over[c] ??= new Path2D()).moveTo(left, top);
      over[c].lineTo(right, bottom);
      // A short highlight along the top stitch gives the thread its twist and sheen.
      (sheen[c] ??= new Path2D()).moveTo(left + pitch * 0.06, top + pitch * 0.02);
      sheen[c].lineTo(right - pitch * 0.2, bottom - pitch * 0.26);
    }

    ctx.lineCap = 'round';
    // A soft shadow under every stitch lifts the thread off the cloth.
    ctx.save();
    ctx.translate(pitch * 0.05, pitch * 0.08);
    ctx.lineWidth = pitch * 0.36;
    ctx.strokeStyle = 'rgb(40 30 15 / 0.28)';
    for (let c = 0; c < PALETTE.length; c++) {
      if (!under[c]) continue;
      ctx.stroke(under[c]);
      ctx.stroke(over[c]);
    }
    ctx.restore();
    for (let c = 0; c < PALETTE.length; c++) {
      if (!under[c]) continue;
      ctx.lineWidth = pitch * 0.38;
      ctx.strokeStyle = PALETTE[c];
      ctx.stroke(under[c]);
      ctx.stroke(over[c]);
      ctx.lineWidth = pitch * 0.1;
      ctx.strokeStyle = LIGHT[c];
      ctx.stroke(sheen[c]);
    }

    // The needle, while it is working: steel, with an eye and a short tail of the thread it is carrying.
    if (progress < 1 && progress > 0 && whole < total) {
      const { x, y, c } = this.#order[whole];
      const px = (x + 0.5) * pitch;
      const py = (y + 0.5) * pitch;
      const length = pitch * 3.2;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-Math.PI / 5);
      ctx.strokeStyle = PALETTE[c];
      ctx.lineWidth = pitch * 0.22;
      ctx.beginPath();
      ctx.moveTo(length * 0.55, 0);
      ctx.bezierCurveTo(length * 0.9, -pitch * 0.9, length * 1.2, pitch * 0.4, length * 1.5, -pitch * 0.2);
      ctx.stroke();
      ctx.strokeStyle = '#d7dbe0';
      ctx.lineWidth = pitch * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.fillStyle = '#7d848c';
      ctx.beginPath();
      ctx.ellipse(length * 0.86, 0, pitch * 0.34, pitch * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace('#', '');
  if (hex.length === 6) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  return [235, 226, 205];
}

if (!customElements.get('media-stitch')) customElements.define('media-stitch', MediaStitch);
