import '@videojs/html/i18n';
import '@/skin.css';
import './showcase.css';
import { createPlayer, FOOTAGE, optionsFromUrl, THEMES, type Footage, type Theme } from '../frame/player';
import { stitchTitle } from './title';

// The public page. ?footage=sample|bright|dark|vertical, ?theme=indigo|black|stone|canvas and ?id=<mux playback id>
// are honoured, so a link can open on any combination.

const initial = optionsFromUrl();
let footage: Footage = initial.footage;
let theme: Theme = initial.theme;

const host = document.getElementById('player')!;

function mount(target: HTMLElement, f: Footage, t: Theme) {
  target.replaceChildren();
  const i18n = document.createElement('media-i18n');
  i18n.append(createPlayer(f, t));
  target.append(i18n);
}

// ---- Pickers ---------------------------------------------------------------------------------------------------------

function chips<T extends string>(
  container: HTMLElement,
  items: { value: T; label: string; swatch?: string }[],
  current: () => T,
  onPick: (value: T) => void
) {
  const render = () => {
    container.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip';
        button.setAttribute('aria-pressed', String(item.value === current()));
        if (item.swatch) {
          const dot = document.createElement('span');
          dot.className = 'swatch';
          dot.style.setProperty('--swatch', item.swatch);
          dot.setAttribute('aria-hidden', 'true');
          button.append(dot);
        }
        button.append(item.label);
        button.addEventListener('click', () => {
          onPick(item.value);
          render();
        });
        return button;
      })
    );
  };
  render();
}

const footageKeys = Object.keys(FOOTAGE);
chips(
  document.getElementById('footage-picks')!,
  footageKeys.map((key) => ({ value: key, label: FOOTAGE[key].label })),
  () => footageKeys.find((key) => FOOTAGE[key] === footage) ?? '',
  (key) => {
    footage = FOOTAGE[key];
    mount(host, footage, theme);
  }
);

const swatches: Record<Theme, string> = { indigo: '#223158', black: '#19191c', stone: '#7c9bbb', canvas: '#d9cdae' };
chips(
  document.getElementById('theme-picks')!,
  THEMES.map((name) => ({ value: name, label: name[0].toUpperCase() + name.slice(1), swatch: swatches[name] })),
  () => theme,
  (name) => {
    theme = name;
    // A fabric is only tokens, so it changes in place without reloading the film.
    for (const target of [host, ...document.querySelectorAll<HTMLElement>('.size-player')]) {
      target.querySelector<HTMLElement>('.media-skin')?.setAttribute('data-sampler-theme', name);
    }
  }
);

// ---- Players ---------------------------------------------------------------------------------------------------------

mount(host, footage, theme);

// The size demos use the bright footage, which is small and always readable by the stitcher.
for (const id of ['size-tablet', 'size-phone']) {
  mount(document.getElementById(id)!, FOOTAGE.bright, theme);
}

// ---- The title is cross-stitched as the page loads ------------------------------------------------------------------

stitchTitle(document.getElementById('title') as HTMLCanvasElement, 'SAMPLER');
