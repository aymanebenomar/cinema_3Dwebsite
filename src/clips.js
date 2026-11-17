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
 * - `light`   colour the screen throws onto the room
 * Empty this list to play only the reel.
 */
export const TRAILERS = [
  { title: 'The Batman', year: 2022, credit: 'Warner Bros. Pictures', youtube: 'mqqft2x_Aa4', start: 106, light: '#ff4436' },
  { title: 'Spider-Man: No Way Home', year: 2021, credit: 'Sony Pictures · Marvel Studios', youtube: 'JfVOs4VSpmA', start: 98, light: '#6b8dff' },
  { title: 'La La Land', year: 2016, credit: 'Lionsgate', youtube: '0pdqf4P9MB8', start: 84, light: '#8c6dff' },
  { title: 'Interstellar', year: 2014, credit: 'Paramount Pictures · Warner Bros.', youtube: 'zSWdZVtXT7E', start: 64, light: '#d4e6ff' },
  { title: 'Top Gun: Maverick', year: 2022, credit: 'Paramount Pictures', youtube: 'giXco2jaZ_4', start: 58, light: '#ffbe73' },
  { title: 'Titanic', year: 1997, credit: 'Paramount Pictures · 20th Century', youtube: '2e-eXJ6HgkQ', start: 60, light: '#5ea6ff' },
  { title: 'Avengers: Endgame', year: 2019, credit: 'Marvel Studios', youtube: 'TcMBFSGVi1c', start: 70, light: '#b48cff' },
  { title: 'The Notebook', year: 2004, credit: 'New Line Cinema', youtube: 'BjJcYdEOI0k', start: 70, light: '#ffcf96' },
  { title: 'Dune', year: 2021, credit: 'Warner Bros. Pictures · Legendary', youtube: '8g18jFHCLXk', start: 95, light: '#ffb25c' },
  { title: 'Joker', year: 2019, credit: 'Warner Bros. Pictures', youtube: 'zAGVQLHvwOY', start: 70, light: '#ffa84c' },
  { title: 'The Dark Knight', year: 2008, credit: 'Warner Bros. Pictures', youtube: 'EXeTwQWrcwY', start: 60, light: '#6c8cff' },
  { title: 'Oppenheimer', year: 2023, credit: 'Universal Pictures', youtube: 'uYPbbksJxIg', start: 65, light: '#ff8a3d' },
];

/** Streaming fallback: the free films, played live (only when enabled above). */
export const CLIPS = (STREAM_WITHOUT_REEL ? films : [])
  .filter((f) => /^https?:/.test(f.src))
  .map(({ title, year, credit, src, start }) => ({ title, year, credit, src, start }));
