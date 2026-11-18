# Cinema 3D website

A film plays fullscreen. Scroll and the camera pulls back and rises: the film becomes the screen of a 3D
cinema, and you end up high on the balcony looking over a curved, C-shaped auditorium while the films keep
playing, 10 seconds each, crossfading from one to the next.

Scroll on and the cinema dissolves into the week's programme while the sound fades away. The title and
the film tickets arrive from the left (the first one spins in), and scrolling slides the tickets along: each is
the film's poster with the day and time it plays. Click one to go back to your seat and watch it.

Everything follows the scroll, in order: the camera move, a moment in your seat, the dissolve, then the tickets.
Scrolling is smoothed with [Lenis](https://github.com/darkroomengineering/lenis).

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
the colours the film throws onto the room, and for the programme its running time, genres and poster.

## The programme

The tickets show the films' official posters, loaded from The Movie Database (TMDB) rather than stored here.
A film's `poster` in `src/clips.js` is the file name from its TMDB image address
(`https://image.tmdb.org/t/p/w500/<poster>.jpg`). If a poster can't load, a still from the film's video stands in.

The showtimes are the next twelve shows from now, one per film in list order, at the times in `SHOWS` in
`src/programme.js` (two a day, one on Mondays and Tuesdays).

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
| `src/main.js` | Renderer, smooth scrolling, scroll → camera move, mouse look. Tunables at the top. |
| `src/cinema.js` | The room: curved stadium rows and seats, balcony, screen, lights and shadows. |
| `src/trailers.js` | Plays the famous films through YouTube's player, with the sound fades around each cut. |
| `src/programme.js` | The programme wall: the tickets, the showtimes and the poster glow behind them. |
| `src/projector.js` | Plays the reel (or streams films) onto the screen and lights the room with its colours. |
| `src/clips.js` | The films (YouTube id, poster, colours…); finds the built reel. |
| `scripts/build-reel.mjs` | Builds the reel. |
| `src/style.css` | Overlay UI, the wall and the tickets. `--zoom-length` and `--hold-length` set how much scrolling the camera move and the pause in your seat take. |
