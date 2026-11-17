# Cinema 3D website

A film plays fullscreen. Scroll a little and the camera pulls back: the film becomes the screen of a 3D cinema,
and you end up sitting in the seats while it keeps playing.

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Use your own film

Put a video at `public/film.mp4`. It's picked up automatically and its aspect ratio sets the screen size.

Until then, a placeholder streams in: **Sintel** © Blender Foundation (durian.blender.org), licensed
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), served from Wikimedia Commons.
If you publish the site with Sintel, keep that credit somewhere on the page.

## Where things are

| File | What it does |
| --- | --- |
| `src/main.js` | Renderer, scroll → camera move, mouse look, bloom/vignette. The tunables are at the top. |
| `src/cinema.js` | The room: screen, curtains, stadium seating, step lights, star ceiling, projector beam, lights. |
| `src/film.js` | Loads the film as a video texture and samples its colour so the screen lights the room. |
| `src/style.css` | Overlay UI. `--scroll-length` sets how much scrolling the zoom-out takes. |

Handy knobs in `src/main.js`: `SEAT` (which row you sit in), `SEAT_FOV`, `SEAT_LOOK_DROP`, `SCROLL_DAMPING`, `CRANE_HEIGHT`.
