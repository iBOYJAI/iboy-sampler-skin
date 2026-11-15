// The page title, cross-stitched. A needle works left to right through each letter, and the letters carry a gold
// shadow stitched one cell down and to the right. It runs once when the title scrolls into view, runs again when the
// title is pressed or tapped, and skips straight to the finished stitching under reduced motion.

const FONT: Record<string, string[]> = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};

const INK = '#223158';
const INK_LIGHT = '#5a6fa8';
const GOLD = '#e8a33d';
const GOLD_LIGHT = '#f6d48a';

type Stitch = { x: number; y: number; ink: boolean };

export function stitchTitle(canvas: HTMLCanvasElement, word: string) {
  const ctx = canvas.getContext('2d')!;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Letters left to right, each column top to bottom, the shadow first so the ink sits on top of it.
  const stitches: Stitch[] = [];
  let cursor = 0;
  for (const letter of word) {
    const rows = FONT[letter];
    if (!rows) continue;
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        if (rows[row][col] === '1') {
          stitches.push({ x: cursor + col + 1, y: row + 1, ink: false });
          stitches.push({ x: cursor + col, y: row, ink: true });
        }
      }
    }
    cursor += 6;
  }

  const cols = cursor - 1 + 1;
  const rowsTotal = 7 + 1;

  let progress = 0;
  let raf = 0;
  let last = 0;
  let size = { w: 0, h: 0, pitch: 0 };

  function layout() {
    const width = canvas.getBoundingClientRect().width || 600;
    const pitch = width / (cols + 1);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(pitch * (rowsTotal + 1) * dpr);
    canvas.style.height = `${pitch * (rowsTotal + 1)}px`;
    size = { w: canvas.width, h: canvas.height, pitch: pitch * dpr };
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, size.w, size.h);
    const { pitch } = size;
    const count = Math.floor(progress * stitches.length);

    ctx.lineCap = 'round';
    for (let n = 0; n < count; n++) {
      const { x, y, ink } = stitches[n];
      const left = x * pitch + pitch * 0.14;
      const top = y * pitch + pitch * 0.14;
      const right = (x + 1) * pitch - pitch * 0.14;
      const bottom = (y + 1) * pitch - pitch * 0.14;

      ctx.lineWidth = pitch * 0.36;
      ctx.strokeStyle = ink ? INK : GOLD;
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, top);
      ctx.moveTo(left, top);
      ctx.lineTo(right, bottom);
      ctx.stroke();

      ctx.lineWidth = pitch * 0.1;
      ctx.strokeStyle = ink ? INK_LIGHT : GOLD_LIGHT;
      ctx.beginPath();
      ctx.moveTo(left + pitch * 0.05, top + pitch * 0.02);
      ctx.lineTo(right - pitch * 0.2, bottom - pitch * 0.26);
      ctx.stroke();
    }

    // The needle, while it is working.
    if (progress > 0 && progress < 1 && count < stitches.length) {
      const { x, y, ink } = stitches[count];
      const px = (x + 0.5) * pitch;
      const py = (y + 0.5) * pitch;
      const length = pitch * 3.6;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-Math.PI / 5);
      ctx.strokeStyle = ink ? INK : GOLD;
      ctx.lineWidth = pitch * 0.2;
      ctx.beginPath();
      ctx.moveTo(length * 0.55, 0);
      ctx.bezierCurveTo(length * 0.9, -pitch * 0.9, length * 1.2, pitch * 0.4, length * 1.6, -pitch * 0.3);
      ctx.stroke();
      ctx.strokeStyle = '#c3c8cf';
      ctx.lineWidth = pitch * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.fillStyle = '#6a717a';
      ctx.beginPath();
      ctx.ellipse(length * 0.86, 0, pitch * 0.32, pitch * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function run() {
    cancelAnimationFrame(raf);
    if (motion.matches) {
      progress = 1;
      draw();
      return;
    }
    progress = 0;
    last = performance.now();
    const tick = (now: number) => {
      progress = Math.min(1, progress + (now - last) / 2200);
      last = now;
      draw();
      if (progress < 1 && !document.hidden) raf = requestAnimationFrame(tick);
      else if (progress < 1) {
        progress = 1;
        draw();
      }
    };
    raf = requestAnimationFrame(tick);
  }

  new ResizeObserver(layout).observe(canvas);
  layout();

  // Start when the title is on screen, then again whenever it is pressed.
  new IntersectionObserver(
    ([entry], observer) => {
      if (entry?.isIntersecting) {
        run();
        observer.disconnect();
      }
    },
    { threshold: 0.4 }
  ).observe(canvas);
  canvas.addEventListener('pointerdown', run);
}
