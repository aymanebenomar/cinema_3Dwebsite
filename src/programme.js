import { TRAILERS } from './clips.js';

/*
 * This week's programme: a wall that rises over the cinema, then stays put while your scrolling slides a
 * row of film cards along it, in the order they play. Each card is the film's poster with the day and
 * time it's on underneath; clicking one takes you back to your seat to watch it.
 *
 * Posters are the films' official ones, loaded from The Movie Database (TMDB), not copies kept in this
 * project. If one can't load, the card falls back to a still from the film's YouTube video.
 */

const POSTERS = 'https://image.tmdb.org/t/p/';

// When the films are on, by day of the week (Sunday first): two shows most days, one early in the week.
// That's twelve a week, one for each film.
const SHOWS = [
  ['16:45', '20:30'], // Sunday
  ['20:30'], // Monday
  ['20:30'], // Tuesday
  ['18:15', '21:00'], // Wednesday
  ['18:15', '21:00'], // Thursday
  ['18:30', '21:15'], // Friday
  ['16:45', '20:30'], // Saturday
];

const weekdayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The next `count` shows from now on, in order. */
function upcomingShows(count, now = new Date()) {
  const shows = [];
  for (let d = 0; shows.length < count && d < 14; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    for (const time of SHOWS[day.getDay()]) {
      const [h, m] = time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (at > now && shows.length < count) shows.push({ at, time });
    }
  }
  return shows;
}

/** "Tonight", "Tomorrow", "Friday"… */
function dayName(at, now) {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86400000);
  if (days === 0) return at.getHours() >= 17 ? 'Tonight' : 'Today';
  if (days === 1) return 'Tomorrow';
  return weekdayLong.format(at);
}

/** "Wednesday 18 – Tuesday 24 November", or across two months "Sunday 29 November – Saturday 5 December". */
function weekText(first, last) {
  const end = `${weekdayLong.format(last)} ${last.getDate()} ${monthLong.format(last)}`;
  const sameMonth = first.getMonth() === last.getMonth();
  return `${weekdayLong.format(first)} ${first.getDate()}${sameMonth ? '' : ` ${monthLong.format(first)}`} – ${end}`;
}

const runtimeText = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
const pad = (n) => String(n).padStart(2, '0');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function filmCard(film, index, show, now, onSelect) {
  const card = el('li', 'film-card');
  card.style.setProperty('--i', index);

  const { at, time } = show;
  const day = dayName(at, now);

  // Each card is a cinema ticket: the poster on top, and below the tear-off line, the stub with the showing.
  // The whole ticket turns over when it's dealt, so it has a back as well as a front.
  const flip = el('div', 'film-card__flip');
  const front = el('button', 'film-card__front');
  front.type = 'button';
  front.setAttribute(
    'aria-label',
    `${film.title}: ${day}, ${weekdayLong.format(at)} ${at.getDate()} ${monthLong.format(at)} at ${time}. Watch it in the cinema`,
  );

  const poster = el('span', 'film-card__poster');
  const img = el('img');
  img.alt = '';
  img.decoding = 'async';
  img.loading = index < 6 ? 'eager' : 'lazy';
  img.sizes = '(max-width: 520px) 64vw, 300px';
  if (film.poster) {
    img.srcset = [342, 500, 780].map((w) => `${POSTERS}w${w}/${film.poster}.jpg ${w}w`).join(', ');
    img.src = `${POSTERS}w500/${film.poster}.jpg`;
    img.dataset.small = `${POSTERS}w342/${film.poster}.jpg`; // enough for the softened glow behind the cards
  }
  const useStill = () => {
    // No poster: a frame from the film's YouTube video, with the title written over it.
    img.removeAttribute('srcset');
    delete img.dataset.small;
    img.src = `https://i.ytimg.com/vi/${film.youtube}/maxresdefault.jpg`;
    poster.classList.add('is-still');
  };
  img.addEventListener('error', () => (poster.classList.contains('is-still') ? img.remove() : useStill()));
  if (!film.poster) useStill();
  poster.append(img, el('span', 'film-card__name', film.title), el('span', 'film-card__watch', 'Watch'));

  // The stub: the date as a little calendar leaf, then the day and the time it starts.
  const stub = el('span', 'film-card__stub');
  const date = el('span', 'film-card__date');
  date.append(
    el('span', 'film-card__weekday', weekdayShort.format(at)),
    el('span', 'film-card__daynum', String(at.getDate())),
    el('span', 'film-card__month', monthShort.format(at)),
  );
  const info = el('span', 'film-card__info');
  const starts = el('span', 'film-card__time');
  const clock = el('time', '', time);
  clock.dateTime = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${time}`;
  starts.append(clock, el('span', 'film-card__length', runtimeText(film.runtime)));
  // Over the time: "Tonight · Action", "Tomorrow · Musical", or for later in the week (the date already says
  // which day) just the film's genres.
  const genres = (film.genre ?? '').split(' · ').filter(Boolean);
  const soon = day === 'Tonight' || day === 'Today' || day === 'Tomorrow';
  const label = soon ? [day, genres[0]] : genres;
  info.append(el('span', 'film-card__when', label.filter(Boolean).join(' · ') || day), starts);
  stub.append(date, info);

  front.append(poster, el('span', 'film-card__perf'), stub);
  front.addEventListener('click', () => onSelect(index));

  const back = el('div', 'film-card__back');
  back.setAttribute('aria-hidden', 'true');
  back.append(
    el('span', 'film-card__admit', 'Admit one'),
    el('span', 'film-card__back-number', pad(index + 1)),
    el('span', 'film-card__back-label', 'Programme'),
  );

  flip.append(front, back);
  card.append(flip);
  return card;
}

export function createProgramme({ onSelect }) {
  const wall = document.getElementById('wall');
  const track = document.getElementById('wall-track');
  const bar = document.getElementById('wall-progress');
  const count = document.getElementById('wall-count');
  const hint = document.getElementById('wall-hint');
  document.getElementById('wall-total').textContent = pad(TRAILERS.length);

  const now = new Date();
  const shows = upcomingShows(TRAILERS.length, now);
  TRAILERS.forEach((film, i) => track.append(filmCard(film, i, shows[i], now, onSelect)));
  document.getElementById('wall-dates').textContent = weekText(shows[0].at, shows[shows.length - 1].at);
  const posters = [...track.querySelectorAll('.film-card__poster img')];
  // Have the first posters decoded well before they're dealt, so none of that work lands mid-entrance.
  setTimeout(() => posters.slice(0, 6).forEach((img) => img.decode?.().catch(() => {})), 2500);

  // Behind the cards, the wall takes on the colours of the film you're looking at: its poster, enlarged and
  // softened into a glow. It comes up as the first card lands, and changes as you scroll from card to card.
  const backdrop = el('div', 'wall-backdrop');
  backdrop.setAttribute('aria-hidden', 'true');
  const layers = [el('img'), el('img')];
  for (const layer of layers) {
    layer.alt = '';
    layer.decoding = 'async';
    backdrop.append(layer);
  }
  wall.querySelector('.wall-pin').prepend(backdrop);
  let focus = -1;
  let front = 0;
  function setFocus(index) {
    if (index === focus) return;
    const img = posters[index];
    const src = img?.currentSrc || img?.dataset.small || img?.src; // the card's own copy if it has loaded
    if (!src) return;
    focus = index;
    const next = layers[1 - front];
    next.onload = () => {
      if (focus !== index) return; // already moved on to another card
      next.classList.add('is-on');
      layers[front].classList.remove('is-on');
      front = 1 - front;
    };
    if (next.src === src && next.complete) next.onload();
    else next.src = src;
  }

  // The programme is a screen fixed in place. Scrolling on from your seat first dissolves the cinema into it,
  // then there's a short pause while the tickets are dealt, then one pixel of scrolling moves them one pixel
  // sideways. The wall section is only there to give the page that much room to scroll.
  const pin = wall.querySelector('.wall-pin');
  let seat = 1;
  let fade = 1;
  let pause = 0;
  let travel = 0;
  function layout() {
    travel = Math.max(0, track.scrollWidth - window.innerWidth);
    fade = Math.round(window.innerHeight * 0.6);
    pause = Math.round(window.innerHeight * 0.3);
    wall.style.setProperty('--wall-length', `${fade + pause + travel}px`);
    seat = Math.max(1, wall.offsetTop - window.innerHeight);
  }
  layout();

  /** Scroll positions: `seat` in the balcony (no programme yet), `top` the programme fully in, `end` the last card. */
  function stops() {
    return { seat, top: seat + fade, end: seat + fade + pause + travel };
  }

  // Once the programme is in, the title and tickets arrive from the left: the first ticket spins in, the rest
  // follow. Going all the way back to the cinema puts them away again, ready for next time.
  let dealt = false;
  let lastX = NaN;
  let lastCover = NaN;
  let shown = 0;
  let hintGone = false;

  /** Call every frame with the scroll position. Returns how much of the cinema the wall covers: 0 to 1. */
  function update(y) {
    const raw = clamp01((y - seat) / fade);
    const cover = raw * raw * (3 - 2 * raw); // the dissolve eases in and out
    const along = travel > 0 ? clamp01((y - seat - fade - pause) / travel) : 0;
    if (cover !== lastCover) {
      pin.style.opacity = cover.toFixed(3);
      pin.style.visibility = cover > 0 ? 'visible' : 'hidden';
      pin.classList.toggle('is-open', cover > 0.6);
      lastCover = cover;
    }
    const x = Math.round(-along * travel * 10) / 10;
    if (x !== lastX) {
      track.style.transform = `translate3d(${x}px, 0, 0)`;
      bar.style.transform = `scaleX(${along.toFixed(4)})`;
      lastX = x;
    }
    const current = Math.round(along * (posters.length - 1)); // the card you're looking at
    if (current !== shown) {
      shown = current;
      count.textContent = pad(current + 1);
    }
    if (cover > 0.02) setFocus(current); // ready before the tickets arrive, so the glow comes in without a hitch
    if (hintGone !== along > 0.03) {
      hintGone = along > 0.03;
      hint.classList.toggle('is-gone', hintGone); // once you're browsing, the cue has done its job
    }
    if (!dealt && cover > 0.9 && !wall.classList.contains('is-leaving')) {
      dealt = true;
      wall.classList.add('is-dealt');
    } else if (cover < 0.02) {
      dealt = false;
      wall.classList.remove('is-dealt', 'is-leaving');
    }
    return cover;
  }

  /** On the way back to the cinema, fade the cards out rather than show them rushing back along the wall. */
  function leave() {
    wall.classList.add('is-leaving');
  }

  return { update, layout, stops, leave };
}
