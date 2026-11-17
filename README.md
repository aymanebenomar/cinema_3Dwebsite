# Cinema 3D website

A film plays fullscreen. Scroll a little and the camera pulls back and rises: the film becomes the screen of
a 3D cinema, and you end up high on the balcony looking over a curved, C-shaped auditorium while the reel
keeps playing, 10 seconds of each film, crossfading from one to the next.

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. If the page ever looks stuck after code changes, hard-refresh (Cmd+Shift+R).

## Famous films

The programme is twelve famous films, 10 seconds each, crossfading round and round: Spider-Man: No Way Home,
The Batman, La La Land, then Interstellar, Top Gun: Maverick, Titanic, Avengers: Endgame, The Notebook, Dune,
Joker, The Dark Knight and Oppenheimer. They're the studios' official videos, played through YouTube's own
embedded player (the legal way to show this footage without owning it), so they need an internet connection.

- Every film fills the screen edge to edge; the black bars many of these videos carry are zoomed out of view.
- Around each cut the sound eases down before the cut and fades back in after it, so lines aren't chopped mid-word.
- The room is lit in each film's colours; the house lights stay at a low glow, as in a real cinema.

Edit the list (`TRAILERS`) in `src/clips.js`: each entry is a YouTube video id, the second to start at,
and the colours the film throws onto the room.

## Sound

Press "Sound on". Films playing from the site's own video file (the reel) take on the echo of a big hall as you
move back into the room. Websites can't process YouTube's audio, so the famous films only get a little quieter
and more distant in the balcony.

## The reel (backup)

If YouTube can't load (offline, blocked), the screen plays one video instead, `src/reel/reel.mp4`, built by:

```bash
npm run reel
```

It takes 10 seconds from every film, picks moments that look like the film rather than a trailer (no black
frames, dark title cards or rapid cutting), fits each to the 2.2:1 screen, evens out the volume, and joins
them with crossfades. It needs `ffmpeg` installed.

Films come from two places:

- **Your own films**: drop video files into `reel/sources/` and run `npm run reel` again. They go first, titled
  from the file name (`1-the-batman.mp4` shows as "The Batman"). Only use footage you have the rights to show.
  These files stay out of git.
- **Free films** in `reel/films.json`, fetched from Wikimedia Commons:
  - *Charade* (1963), *His Girl Friday* (1940), *Night of the Living Dead* (1968), *Detour* (1945): public domain.
  - *Tears of Steel* (2012): © Blender Foundation, mango.blender.org, licensed
    [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Keep this credit if you publish the site.

To pick a moment yourself, add `"start": 95` (seconds) to a film's entry in `reel/films.json`. The script
remembers its picks in `reel/.cache/picks.json`; delete that file to let it choose again.

If no reel has been built, the screen says so. You can make the site stream the free films live instead by
setting `STREAM_WITHOUT_REEL = true` in `src/clips.js`, but it's slower to start and Wikimedia rate-limits it.

## Where things are

| File | What it does |
| --- | --- |
| `src/main.js` | Renderer, scroll → camera move (spring-smoothed), mouse look. Tunables at the top. |
| `src/cinema.js` | The room: curved stadium rows and seats, balcony, screen, curtains, lights and shadows. |
| `src/projector.js` | Plays the reel (or streams films) onto the screen and lights the room with its colours. |
| `src/clips.js` | Finds the built reel; lists the streaming fallback. |
| `scripts/build-reel.mjs` | Builds the reel. |
| `src/style.css` | Overlay UI. `--scroll-length` sets how much scrolling the move takes. |
