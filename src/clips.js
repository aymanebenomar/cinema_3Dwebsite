/**
 * What plays on the cinema screen.
 *
 * Normally that's the REEL: one pre-built video with 10 seconds of every film, crossfaded. Build it with
 * `npm run reel` — to add your own films, see reel/sources/README.md. Being a local file, it starts
 * instantly and never buffers.
 *
 * Without a reel, the site can stream the free films in reel/films.json live from Wikimedia Commons
 * instead (set STREAM_WITHOUT_REEL to true). It's off by default: live streaming is slow to start and
 * Wikimedia rate-limits it.
 *
 * Add `?clip=2` to the URL to start at the third film (0-based).
 */
import films from '../reel/films.json';

export const CLIP_SECONDS = 10;

const STREAM_WITHOUT_REEL = false;

const reelVideo = Object.values(import.meta.glob('./reel/reel.mp4', { query: '?url', import: 'default', eager: true }))[0];
const reelInfo = Object.values(import.meta.glob('./reel/reel.json', { import: 'default', eager: true }))[0];

/** The pre-built reel, or null. Shape: { src, segmentSeconds, fadeSeconds, duration, films: [{ title, year, credit, at }] } */
export const REEL = reelVideo && reelInfo ? { src: reelVideo, ...reelInfo } : null;

/**
 * Studio films, shown as their OFFICIAL TRAILERS through YouTube's own embedded player — the legal way
 * to show this footage without owning it. They play first, 10 seconds each, then the reel.
 * - `youtube` video id (the part after `watch?v=`)
 * - `start`   second of the trailer to show
 * - `light`   colours the screen throws onto the room (it drifts between them)
 * - `runtime`, `genre` shown on the film's card in the weekly programme
 * - `poster`  the film's official poster on The Movie Database (TMDB): the file name from its image address,
 *             https://image.tmdb.org/t/p/w500/<poster>.jpg. It's loaded from there, not stored here.
 * Empty this list to play only the reel.
 */
export const TRAILERS = [
  { title: 'Spider-Man: No Way Home', runtime: 148, genre: 'Action · Adventure', year: 2021, credit: 'Sony Pictures · Marvel Studios', poster: '1g0dhYtq4irTY1GPXvft6k4YLjm', youtube: 'JfVOs4VSpmA', start: 98, light: ['#e8252f', '#3d6bff', '#ffcf5a'] },
  { title: 'The Batman', runtime: 176, genre: 'Crime · Action', year: 2022, credit: 'Warner Bros. Pictures', poster: '74xTEgt7R36Fpooo50r9T25onhq', youtube: 'mqqft2x_Aa4', start: 106, light: ['#ff3b2a', '#ff8a3d', '#5a1010'] },
  { title: 'La La Land', runtime: 128, genre: 'Musical · Romance', year: 2016, credit: 'Lionsgate', poster: 'uDO8zWDhfWwoFdKS4fzkUJt0Rf0', youtube: '0pdqf4P9MB8', start: 84, light: ['#7b5cff', '#ffd25a', '#3fa2ff'] },
  { title: 'Interstellar', runtime: 169, genre: 'Sci-Fi · Drama', year: 2014, credit: 'Paramount Pictures · Warner Bros.', poster: 'yQvGrMoipbRoddT0ZR8tPoR7NfX', youtube: 'zSWdZVtXT7E', start: 64, light: ['#d6e8ff', '#ffb35a', '#7fa8c9'] },
  { title: 'Top Gun: Maverick', runtime: 131, genre: 'Action · Drama', year: 2022, credit: 'Paramount Pictures', poster: 'n0YuM4f5lvGAP6MAW2kBIzugXnc', youtube: 'giXco2jaZ_4', start: 58, light: ['#ffb45c', '#4fb3ff', '#ff7a3a'] },
  { title: 'Titanic', runtime: 194, genre: 'Romance · Drama', year: 1997, credit: 'Paramount Pictures · 20th Century', poster: '9xjZS2rlVxm8SFx8kPC3aIGCOYQ', youtube: '2e-eXJ6HgkQ', start: 60, light: ['#3f8cff', '#ffcc7a', '#1c4f9a'] },
  { title: 'Avengers: Endgame', runtime: 181, genre: 'Action · Sci-Fi', year: 2019, credit: 'Marvel Studios', poster: 'jtDv3lCnST0fZRvdYFwR5CVwK2x', youtube: 'TcMBFSGVi1c', start: 70, light: ['#9b6bff', '#ff8a3d', '#4f7dff'] },
  { title: 'The Notebook', runtime: 123, genre: 'Romance · Drama', year: 2004, credit: 'New Line Cinema', poster: 'rNzQyW4f8B8cQeg7Dgj3n6eT5k9', youtube: 'BjJcYdEOI0k', start: 70, light: ['#ffcf8a', '#7fcf8a', '#ff9a6a'] },
  { title: 'Dune', runtime: 155, genre: 'Sci-Fi · Adventure', year: 2021, credit: 'Warner Bros. Pictures · Legendary', poster: 'v1tRXZ4JtD2Iv6fjkPvT4GiwslV', youtube: '8g18jFHCLXk', start: 95, light: ['#ffb25c', '#c97a3a', '#ffe0a0'] },
  { title: 'Joker', runtime: 122, genre: 'Crime · Drama', year: 2019, credit: 'Warner Bros. Pictures', poster: 'udDclJoHjfjb8Ekgsd4FDteOkCU', youtube: 'zAGVQLHvwOY', start: 70, light: ['#ff8a2a', '#3fbf8a', '#ffcf4a'] },
  { title: 'The Dark Knight', runtime: 152, genre: 'Crime · Action', year: 2008, credit: 'Warner Bros. Pictures', poster: 'qJ2tW6WMUDux911r6m7haRef0WH', youtube: 'EXeTwQWrcwY', start: 60, light: ['#3f6bff', '#ff9a3a', '#9ab0d0'] },
  { title: 'Oppenheimer', runtime: 180, genre: 'Drama · History', year: 2023, credit: 'Universal Pictures', poster: '8Gxv8gSFCU0XGDykEGv7zR1n2ua', youtube: 'uYPbbksJxIg', start: 65, light: ['#ff7a2a', '#ffd08a', '#5a6a8a'] },
];

/** Streaming fallback: the free films, played live (only when enabled above). */
export const CLIPS = (STREAM_WITHOUT_REEL ? films : [])
  .filter((f) => /^https?:/.test(f.src))
  .map(({ title, year, credit, src, start }) => ({ title, year, credit, src, start }));
