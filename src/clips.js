/**
 * Tonight's programme: real films, CLIP_SECONDS each, crossfading from one to the next.
 *
 * YOUR OWN CLIPS — drop video files (.mp4, .webm, .mov, .m4v) into `src/clips/`.
 * They're picked up automatically, play first, and are titled from the file name:
 * `the-batman.mp4` shows as "The Batman", `la_la_land.mp4` as "La La Land".
 * Only use footage you have the rights to show.
 *
 * After your clips come free films you're allowed to show anywhere: public-domain Hollywood
 * classics plus the open-licensed "Tears of Steel", streamed from Wikimedia Commons.
 *
 * Fields:
 * - `src`    video URL (mp4 or webm). Remote files must allow cross-origin use (CORS).
 * - `start`  second to start the excerpt at. Leave it out to pick a random scene each time.
 * - `credit` small print under the title.
 *
 * Start at a specific clip with `?clip=2` in the URL (0-based).
 */
export const CLIP_SECONDS = 10;

/** Set to false to show only your own clips once you've added some. */
const INCLUDE_FREE_FILMS = true;

const localFiles = import.meta.glob('./clips/*.{mp4,webm,mov,m4v,MP4,WEBM,MOV,M4V}', {
  query: '?url',
  import: 'default',
  eager: true,
});

const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'in', 'on', 'at', 'to', 'vs']);
function titleFromFile(path) {
  const words = path
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(/\s+/);
  return words
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

const YOUR_CLIPS = Object.entries(localFiles)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, src]) => ({ title: titleFromFile(path), src }));

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/transcoded';

const FREE_FILMS = [
  {
    title: 'Charade',
    year: 1963,
    credit: 'Public domain',
    src: `${COMMONS}/e/ef/Charade_%28Stanley_Donen%2C_1963%29.webm/Charade_%28Stanley_Donen%2C_1963%29.webm.1080p.vp9.webm`,
  },
  {
    title: 'Tears of Steel',
    year: 2012,
    credit: '© Blender Foundation · CC BY 3.0',
    src: `${COMMONS}/c/cb/Tears_of_Steel_1080p.webm/Tears_of_Steel_1080p.webm.1080p.vp9.webm`,
  },
  {
    title: 'His Girl Friday',
    year: 1940,
    credit: 'Public domain',
    src: `${COMMONS}/d/df/His_Girl_Friday_%281940%29_by_Howard_Hawks.webm/His_Girl_Friday_%281940%29_by_Howard_Hawks.webm.1080p.vp9.webm`,
  },
  {
    title: 'Night of the Living Dead',
    year: 1968,
    credit: 'Public domain',
    src: `${COMMONS}/2/24/Night_of_the_Living_Dead_%281968%29.webm/Night_of_the_Living_Dead_%281968%29.webm.1080p.vp9.webm`,
  },
  {
    title: 'Detour',
    year: 1945,
    credit: 'Public domain',
    src: `${COMMONS}/b/b7/Detour_%281945%29_by_Edgar_G._Ulmer.webm/Detour_%281945%29_by_Edgar_G._Ulmer.webm.1080p.vp9.webm`,
  },
];

export const CLIPS = [...YOUR_CLIPS, ...(INCLUDE_FREE_FILMS || YOUR_CLIPS.length === 0 ? FREE_FILMS : [])];
