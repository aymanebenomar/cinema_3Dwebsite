/**
 * Tonight's programme: real films, CLIP_SECONDS each, crossfading from one to the next.
 *
 * The defaults are feature films you're allowed to show: public-domain Hollywood classics plus the
 * open-licensed "Tears of Steel", streamed from Wikimedia Commons.
 *
 * Your own clips: put the video files in `public/clips/` and list them here, for example
 *   { title: 'My film', year: 2024, src: '/clips/my-film.mp4', start: 0 },
 * Only use footage you have the rights to show.
 *
 * - `src`    video URL (mp4 or webm). Remote files must allow cross-origin use (CORS).
 * - `start`  second to start the excerpt at. Leave it out to pick a random scene each time.
 * - `credit` small print shown under the title.
 *
 * Start at a specific clip with `?clip=2` in the URL (0-based).
 */
export const CLIP_SECONDS = 10;

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/transcoded';

export const CLIPS = [
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
