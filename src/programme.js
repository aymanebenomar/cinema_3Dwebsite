import { TRAILERS } from './clips.js';

/*
 * This week's programme: a wall that rises over the cinema as you scroll on, then stays put while your
 * scrolling slides a row of film cards along it. Each card shows the film and its showtimes for the
 * next seven days; clicking one takes you back to the cinema to watch it.
 *
 * Card pictures are the films' own YouTube thumbnails, loaded straight from YouTube (the same official
 * videos the cinema plays), not copies stored in this project.
 */

// Showtimes a cinema like this would run. Each film gets a few per day, the same on every visit.
const SLOTS = ['11:45', '13:20', '14:30', '15:50', '17:10', '18:30', '19:45', '20:40', '21:30', '22:50'];

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** A well-mixed integer hash: the same input always gives the same programme. */
function hash(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Two to four showtimes for one film on one day; more at the weekend. */
function showtimes(film, date) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const weekend = [0, 5, 6].includes(date.getDay());
  let h = hash(film * 977 + day);
  const count = (weekend ? 3 : 2) + (h % 2);
  const picks = new Set();
  while (picks.size < count) {
    picks.add(SLOTS[h % SLOTS.length]);
    h = hash(h + 1);
  }
  return [...picks].sort();
}

const runtimeText = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function filmCard(film, index, days, onSelect) {
  const card = el('li', 'film-card');

  const poster = el('button', 'film-card__poster');
  poster.type = 'button';
  poster.setAttribute('aria-label', `Watch ${film.title} in the cinema`);
  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  // A plain frame from the film (YouTube keeps stills from a quarter, half and three quarters of the way
  // through), rather than the uploaded thumbnail, which often has text printed over it.
  img.src = `https://i.ytimg.com/vi/${film.youtube}/maxres${film.still ?? 2}.jpg`;
  img.addEventListener(
    'error',
    () => {
      if (img.src.includes('maxresdefault')) img.remove(); // the card's own colours stay behind it
      else img.src = `https://i.ytimg.com/vi/${film.youtube}/maxresdefault.jpg`;
    },
  );
  poster.style.setProperty('--tint', [].concat(film.light)[0]);
  poster.append(img, el('span', 'film-card__number', String(index + 1).padStart(2, '0')), el('span', 'film-card__watch', 'Watch'));
  poster.addEventListener('click', () => onSelect(index));

  const body = el('div', 'film-card__body');
  body.append(
    el('h3', 'film-card__title', film.title),
    el('p', 'film-card__meta', [film.year, runtimeText(film.runtime), film.genre].filter(Boolean).join(' · ')),
    el('p', 'film-card__studio', film.credit),
  );

  const week = el('ul', 'film-card__week');
  days.forEach((date, d) => {
    const row = el('li', d === 0 ? 'is-today' : '');
    const label = d === 0 ? 'Today' : `${weekday.format(date)} ${date.getDate()}`;
    const times = el('span', 'film-card__times');
    for (const t of showtimes(index, date)) {
      const time = el('time', '', t);
      time.dateTime = t;
      times.append(time);
    }
    row.append(el('span', 'film-card__day', label), times);
    week.append(row);
  });
  body.append(week);

  card.append(poster, body);
  return card;
}

export function createProgramme({ onSelect }) {
  const wall = document.getElementById('wall');
  const track = document.getElementById('wall-track');
  const bar = document.getElementById('wall-progress');

  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  const last = days[6];
  document.getElementById('wall-dates').textContent =
    `${weekdayLong.format(days[0])} ${dayMonth.format(days[0])} – ${weekdayLong.format(last)} ${dayMonth.format(last)}`;

  TRAILERS.forEach((film, i) => track.append(filmCard(film, i, days, onSelect)));

  // The wall is as tall as the screen plus however far the cards have to travel, so one pixel of
  // scrolling moves the cards one pixel sideways.
  let wallTop = 0;
  let travel = 0;
  function layout() {
    travel = Math.max(0, track.scrollWidth - window.innerWidth);
    wall.style.setProperty('--wall-travel', `${travel}px`);
    wallTop = wall.offsetTop;
  }
  layout();
  addEventListener('resize', layout);

  let x = 0;
  /** Call every frame. Returns how much of the cinema the wall covers: 0 (none) to 1 (all of it). */
  function update(dt) {
    const y = window.scrollY;
    const cover = clamp01((y - (wallTop - window.innerHeight)) / window.innerHeight);
    const along = travel > 0 ? clamp01((y - wallTop) / travel) : 0;
    x += (-along * travel - x) * (1 - Math.exp(-dt * 9)); // glide, never jump
    track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
    bar.style.transform = `scaleX(${along.toFixed(4)})`;
    return cover;
  }

  return { update, layout };
}
