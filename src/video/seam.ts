// <media-seam>: the seek bar, sewn.
//
// The unplayed part of the film is a chalked guide line. As the film plays, a machine stitches a zigzag along it, and the
// height of each stitch is how loud that moment was, so the finished seam is a thread waveform of what you have heard.
// Loudness is sampled against position, so nothing is pre-analysed and it works with any media the page can play.
//
// The audio is read from a captured copy of the stream and never routed to the speakers, so it cannot change what the
// viewer hears. Browsers without captureStream, or media without CORS headers, get an even seam instead, so the seek bar
// always works. The loop runs only while the film plays, the seam is on screen and reduced motion is off.

import { findVideo } from './stitch-stage';

const STEP = 5;

export class MediaSeam extends HTMLElement {
  #canvas = document.createElement('canvas');
  #ctx = this.#canvas.getContext('2d')!;

  #container: HTMLElement | null = null;
  #slider: HTMLElement | null = null;
  #video: HTMLVideoElement | null = null;
  #watchers: MutationObserver[] = [];
  #resize: ResizeObserver | null = null;
  #visible = new IntersectionObserver(([entry]) => {
    this.#inView = !!entry?.isIntersecting;
    this.#schedule();
  });
  #motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  #inView = false;
  #raf = 0;
  #thread = '#e8a33d';
  #chalk = '#d9d4c7';

  #cols = 0;
  #rows = 0;
  #energy = new Float32Array(0);
  #known = new Uint8Array(0);
  #duration = 0;

  #audio: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #buffer = new Uint8Array(1024);
  #audioFailed = false;
  #level = 0;

  connectedCallback() {
    this.setAttribute('aria-hidden', 'true');
    this.#canvas.className = 'seam-canvas';
    this.append(this.#canvas);

    this.#container = this.closest<HTMLElement>('.media-skin');
    this.#slider = this.closest<HTMLElement>('media-time-slider');
    if (!this.#container) return;

    const play = this.#container.querySelector('media-play-button');
    if (play) {
      const watcher = new MutationObserver(() => {
        this.#bind();
        this.#schedule();
      });
      watcher.observe(play, { attributes: true, attributeFilter: ['data-paused', 'data-started', 'data-ended'] });
      this.#watchers.push(watcher);
    }

    const theme = new MutationObserver(() => {
      this.#readTokens();
      this.#draw();
    });
    theme.observe(this.#container, { attributes: true, attributeFilter: ['data-sampler-theme', 'style'] });
    this.#watchers.push(theme);

    this.#resize = new ResizeObserver(() => this.#layout());
    this.#resize.observe(this);
    this.#visible.observe(this);

    this.#readTokens();
    this.#layout();
    this.#bind();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    this.#watchers.forEach((watcher) => watcher.disconnect());
    this.#watchers = [];
    this.#resize?.disconnect();
    this.#visible.disconnect();
    this.#unbind();
    void this.#audio?.close();
    this.#audio = null;
  }

  #readTokens() {
    if (!this.#container) return;
    const style = getComputedStyle(this.#container);
    this.#thread = style.getPropertyValue('--sm-thread').trim() || '#e8a33d';
    this.#chalk = style.getPropertyValue('--sm-chalk').trim() || '#d9d4c7';
  }

  #bind() {
    const video = findVideo(this.#container);
    if (video === this.#video) return;

    this.#unbind();
    this.#video = video;
    for (const type of ['playing', 'timeupdate', 'seeked', 'durationchange', 'loadedmetadata', 'emptied'] as const) {
      video?.addEventListener(type, this.#onMedia);
    }
  }

  #unbind() {
    for (const type of ['playing', 'timeupdate', 'seeked', 'durationchange', 'loadedmetadata', 'emptied'] as const) {
      this.#video?.removeEventListener(type, this.#onMedia);
    }
    this.#video = null;
  }

  #onMedia = (event: Event) => {
    if (event.type === 'emptied') this.#reset();
    if (event.type === 'playing') this.#initAudio();
    if (this.#video && this.#video.duration !== this.#duration) this.#reset();
    this.#schedule();
  };

  // New media, or a new length: forget what was heard.
  #reset() {
    this.#duration = this.#video?.duration && Number.isFinite(this.#video.duration) ? this.#video.duration : 0;
    this.#energy = new Float32Array(this.#cols);
    this.#known = new Uint8Array(this.#cols);
    this.#container?.removeAttribute('data-seam');
  }

  #layout() {
    const box = this.getBoundingClientRect();
    if (box.width === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#canvas.width = Math.round(box.width * dpr);
    this.#canvas.height = Math.round(box.height * dpr);

    const cols = Math.max(1, Math.floor(box.width / STEP));
    if (cols !== this.#cols) {
      const energy = new Float32Array(cols);
      const known = new Uint8Array(cols);
      // Keep what was heard when the player is resized, remapped onto the new column count.
      for (let c = 0; c < cols && this.#cols > 0; c++) {
        const from = Math.min(this.#cols - 1, Math.floor((c / cols) * this.#cols));
        energy[c] = this.#energy[from] ?? 0;
        known[c] = this.#known[from] ?? 0;
      }
      this.#energy = energy;
      this.#known = known;
      this.#cols = cols;
    }
    this.#rows = Math.max(1, Math.floor(box.height / STEP));
    this.#draw();
  }

  // Taps a copy of the audio. It is analysed, never played, so listening is unaffected.
  #initAudio() {
    if (this.#audio || this.#audioFailed || !this.#video) return;

    const video = this.#video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
    const capture = video.captureStream ?? video.mozCaptureStream;
    if (!capture) {
      this.#audioFailed = true;
      return;
    }

    try {
      const track = capture.call(video).getAudioTracks()[0];
      if (!track) return; // not ready yet; the next `playing` tries again

      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audio = new Context();
      const source = audio.createMediaStreamSource(new MediaStream([track]));
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;

      // Some browsers only run an analyser that reaches the destination, so end the chain in a silent gain.
      const silent = audio.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(audio.destination);
      void audio.resume();

      this.#audio = audio;
      this.#analyser = analyser;
    } catch {
      this.#audioFailed = true;
    }
  }

  #sampleLevel() {
    const analyser = this.#analyser;
    if (!analyser) return 0;

    analyser.getByteTimeDomainData(this.#buffer);
    let sum = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      const v = (this.#buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.#buffer.length);
    const target = Math.pow(Math.min(1, rms / 0.2), 0.7);
    // Quick to rise, slower to fall, so a drum hit reads as a swell instead of a flicker.
    this.#level += (target - this.#level) * (target > this.#level ? 0.5 : 0.18);
    return rms;
  }

  #fraction(): number {
    const video = this.#video;
    if (this.#slider?.hasAttribute('data-dragging')) {
      const pointer = parseFloat(getComputedStyle(this.#slider).getPropertyValue('--media-slider-pointer'));
      if (Number.isFinite(pointer)) return Math.min(1, Math.max(0, pointer / 100));
    }
    if (!video || !video.duration || !Number.isFinite(video.duration)) return 0;
    return Math.min(1, Math.max(0, video.currentTime / video.duration));
  }

  // One frame now if the film is paused or motion is reduced, a running loop while it plays.
  #schedule() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;

    const playing = !!this.#video && !this.#video.paused && !this.#video.ended;
    if (playing && this.#inView && !document.hidden && !this.#motion.matches) {
      this.#raf = requestAnimationFrame(this.#loop);
    } else {
      this.#record();
      this.#draw();
    }
  }

  #loop = () => {
    this.#record();
    this.#draw();
    this.#raf = 0;
    this.#schedule();
  };

  // Writes the current loudness against the position being heard.
  #record() {
    const video = this.#video;
    if (!video || !this.#analyser || video.paused || !this.#cols) return;

    const rms = this.#sampleLevel();
    if (rms > 0.0015) this.#container?.setAttribute('data-seam', '');

    const col = Math.min(this.#cols - 1, Math.floor(this.#fractionOfMedia() * this.#cols));
    this.#energy[col] = this.#known[col] ? Math.max(this.#energy[col], this.#level) : this.#level;
    this.#known[col] = 1;
  }

  #fractionOfMedia() {
    const video = this.#video;
    if (!video || !video.duration || !Number.isFinite(video.duration)) return 0;
    return Math.min(1, video.currentTime / video.duration);
  }

  #draw() {
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.#cols || !width) return;

    const scale = width / Math.max(1, this.getBoundingClientRect().width);
    const step = STEP * scale;
    const mid = height / 2;
    const reach = height / 2 - 2.5 * scale;
    const played = this.#fraction() * this.#cols;

    // The chalked guide line the machine has yet to sew.
    ctx.strokeStyle = this.#chalk;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.6 * scale;
    ctx.lineCap = 'round';
    ctx.setLineDash([3 * scale, 5 * scale]);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, played * step), mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (played <= 0) return;

    // The seam: one vertex per column, alternating above and below the line.
    const path = new Path2D();
    path.moveTo(0, mid);
    for (let c = 0; c < this.#cols && c < played; c++) {
      const heard = this.#known[c] ? this.#energy[c] : 0.3;
      const amplitude = Math.max(1.5 * scale, heard * reach);
      const x = (c + 0.5) * step;
      path.lineTo(x, mid + (c % 2 === 0 ? -amplitude : amplitude));
    }
    path.lineTo(Math.min(width, played * step), mid);

    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.#thread;
    ctx.lineWidth = 2.3 * scale;
    ctx.stroke(path);
    // A thin lighter pass along the same path gives the thread its sheen.
    ctx.strokeStyle = 'rgb(255 255 255 / 0.32)';
    ctx.lineWidth = 0.8 * scale;
    ctx.translate(-0.4 * scale, -0.5 * scale);
    ctx.stroke(path);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

if (!customElements.get('media-seam')) customElements.define('media-seam', MediaSeam);
