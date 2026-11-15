# iBOY Sampler

A [Video.js v10](https://videojs.org) skin you can sew, made by [iBOY Innovation Hub](https://www.iboyhub.com) in Tiruppur, India, for the Video.js Skins Design Challenge.

The player is made like a garment.

- **The frame is re-stitched.** Pause, and a needle sews the frozen frame back in, one cross at a time, in 36 embroidery thread colours on aida cloth. Cells close to the cloth are left bare, as a stitcher would. The poster before play is a finished sampler, and pressing play unpicks it (`src/video/stitch-stage.ts`).
- **The seam is the sound.** The seek bar is a chalked line. As the film plays, a zigzag is sewn along it and each stitch is as tall as that moment was loud. Loudness is sampled against position, so nothing is pre-analysed. The audio is read from a captured copy of the stream and never routed to the speakers; browsers without `captureStream`, or media without CORS headers, get an even seam instead (`src/video/seam.ts`).
- **Rivets, buttons, patches.** Play is a domed copper rivet. Other controls are sewn buttons with their icons redrawn as running stitches. The panel is denim with double gold topstitching, the title is a leather patch, the time is a typewritten care label and tooltips are hang tags (`src/video/sampler.css`).
- **Four fabrics:** Indigo, Black (with iBOY Signal Green thread), Stone and Canvas, set with `data-sampler-theme`. Each only changes tokens.
- **Responsive by the player's own width.** Narrow players drop the title and the cast and picture-in-picture buttons and hand the centre cluster over to the panel.

## Accessibility

Controls sit on a solid denim panel, never on the picture (light text on Indigo is above 10 to 1). Keyboard order matches the layout, focus rings are thick and always visible, buttons are 44px on touch screens (never below 40px elsewhere), forced-colors and high-contrast modes swap the fabric for system colours, and reduced motion removes the travelling needle and slows the seam to a few redraws a second. I checked keyboard order, focus, contrast and layout by hand; an automated axe run was not completed.

## Run it

```bash
npm install
npm run dev
```

The public page is `apps/preview/index.html`; the Video.js workbench is at `/workbench.html`; the bare player is `/preview.html`.

Query options: `?footage=sample|bright|dark|vertical`, `?theme=indigo|black|stone|canvas`, `?id=<mux playback id>`.

To play your own Mux video, add an entry to `FOOTAGE` in `apps/preview/src/frame/player.ts`.

## Use it

Paste `src/video/skin.html` inside a `<video-player>` with your `<mux-video>` or `<video>` where the comment is, and import `src/video/skin.ts` (it registers the Video.js parts, the icons and the two custom elements). Load Poppins and Courier Prime on your page.

| Property | Default |
| --- | --- |
| `data-sampler-theme` | `indigo` (also `black`, `stone`, `canvas`) |
| `--media-accent-color` | thread colour, gold `#e8a33d` |
| `--media-accent-text-color` | text on the thread |
| `--media-border-radius` | `20px` |
| `--media-font-family` | Poppins |

## Credits and licence

Apache 2.0 (see `LICENSE` and `NOTICE`). Fonts: Poppins and Courier Prime, SIL Open Font License 1.1. Footage: the Mux sample film, and iBOY's own clips in `apps/preview/public/media`.
