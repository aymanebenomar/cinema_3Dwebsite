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

Twelve famous films play first, 10 seconds each, crossfading into one another: The Batman, Spider-Man: No Way
Home, La La Land, Interstellar, Top Gun: Maverick, Titanic, Avengers: Endgame, The Notebook, Dune, Joker,
The Dark Knight and Oppenheimer. They're the studios' official videos, played through YouTube's own embedded
player at up to 1080p, because that's the legal way to show this footage without owning it. They need an
internet connection. The reel below plays while they load and after they finish, so the screen is never black.

Edit the list (`TRAILERS`) in `src/clips.js`: each entry is a YouTube video id, the second to start at,
and a light colour for the room. Empty the list to show only the reel.

## The reel

The rest of the programme is one video, `src/reel/reel.mp4`, built by:

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
