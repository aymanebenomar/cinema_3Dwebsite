#!/usr/bin/env node
/**
 * Builds the cinema's programme into ONE video: 10 seconds of every film, crossfaded.
 *
 *   npm run reel
 *
 * Films come from two places:
 *   - reel/sources/   any video files you drop in (they go first, titled from the file name)
 *   - reel/films.json the free films (public domain / Creative Commons), fetched from the web
 *
 * For every film the script scans a dozen spots, scores them, and keeps the 10 seconds that look most
 * like the film itself: bright, colourful, few hard cuts, no black frames or dark title cards (the
 * things that make a clip look like a trailer). Set "start" in films.json to choose a moment yourself.
 *
 * Output: src/reel/reel.mp4 + src/reel/reel.json (titles and timings for the "Now showing" card).
 * Needs ffmpeg and ffprobe on your PATH.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REEL_DIR = path.join(ROOT, 'reel');
const SOURCES_DIR = path.join(REEL_DIR, 'sources');
const CACHE_DIR = path.join(REEL_DIR, '.cache');
const OUT_DIR = path.join(ROOT, 'src', 'reel');

const SEGMENT = 10; // seconds each film is on screen
const FADE = 1; // crossfade between films
const WIDTH = 1920;
const HEIGHT = 872; // the cinema screen is 2.2:1
const FPS = 30;
const MAX_CROP = 1; // always fill the screen edge to edge: crop rather than show black bars
const STRETCH = 90; // seconds of each feature film scanned per stretch
const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv)$/i;

/* ---------- helpers ---------- */

// Wikimedia asks automated clients to identify themselves, and rate-limits anonymous bursts.
const USER_AGENT = 'cinema-reel-builder/0.1 (local video build script)';
const isRemote = (src) => /^https?:/i.test(src);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Wikimedia only serves media files to HTTP/2 clients, and ffmpeg speaks HTTP/1.1. So ffmpeg reads web
 * sources through a tiny local relay that forwards each request (including seeks, as byte ranges) over
 * HTTP/2 with a proper user agent.
 */
let relay = null;
const inputOptions = () => [];
const input = (src) => (isRemote(src) && relay ? relay.url(src) : src);

async function startRelay() {
  const sessions = new Map();
  const session = (origin) => {
    let s = sessions.get(origin);
    if (!s || s.closed || s.destroyed) {
      s = http2.connect(origin);
      s.on('error', () => sessions.delete(origin));
      s.on('close', () => sessions.delete(origin));
      sessions.set(origin, s);
    }
    return s;
  };
  const server = http.createServer((req, res) => {
    let target;
    try {
      target = new URL(decodeURIComponent(req.url.slice(1)));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const headers = { ':method': req.method, ':path': target.pathname + target.search, 'user-agent': USER_AGENT, accept: '*/*' };
    if (req.headers.range) headers.range = req.headers.range;
    const upstream = session(target.origin).request(headers, { endStream: true });
    upstream.on('response', (h) => {
      const out = {};
      for (const [k, v] of Object.entries(h)) if (!k.startsWith(':')) out[k] = v;
      res.writeHead(h[':status'], out);
      if (req.method === 'HEAD') {
        upstream.close();
        res.end();
      } else {
        upstream.pipe(res);
      }
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // ffmpeg drops the connection when it seeks: stop the matching upstream download too.
    res.on('close', () => {
      if (!res.writableFinished) upstream.close();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: (src) => `http://127.0.0.1:${port}/${encodeURIComponent(src)}`,
    close: () => {
      server.close();
      for (const s of sessions.values()) s.close();
    },
  };
}

/** Run ffmpeg/ffprobe; for web sources, pause between requests and back off when rate-limited. */
async function runMedia(cmd, args, src) {
  if (!isRemote(src)) return run(cmd, args);
  for (let attempt = 0; ; attempt++) {
    await wait(1500);
    try {
      return await run(cmd, args);
    } catch (err) {
      if (!/429|Too Many Requests/i.test(err.message) || attempt >= 5) throw err;
      const pause = 20 * (attempt + 1);
      process.stdout.write(`(server busy, waiting ${pause}s) `);
      await wait(pause * 1000);
    }
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} not found — install ffmpeg first`) : e));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed:\n${err.slice(-1500)}`))));
  });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'in', 'on', 'at', 'to', 'vs']);
function titleFromFile(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[\s._-]+/, '') // "1-the-batman" → "the-batman" (numbers only set the order)
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

async function probe(src) {
  const json = JSON.parse(
    await runMedia(
      'ffprobe',
      [
        '-v', 'error',
        ...inputOptions(src),
        '-show_entries', 'format=duration:stream=codec_type,width,height,sample_aspect_ratio',
        '-of', 'json',
        input(src),
      ],
      src,
    ),
  );
  const video = json.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('no video stream');
  const sar = video.sample_aspect_ratio && !video.sample_aspect_ratio.startsWith('0') ? video.sample_aspect_ratio : '1:1';
  const [sn, sd] = sar.split(':').map(Number);
  return {
    duration: Number(json.format.duration) || 0,
    aspect: (video.width * (sn / sd)) / video.height,
    hasAudio: json.streams.some((s) => s.codec_type === 'audio'),
  };
}

/* ---------- picking the 10 seconds ---------- */

/**
 * Brightness, saturation and scene-change score, 3 times a second, over one continuous stretch of a
 * film (one read, so it's quick and gentle on web servers). Each frame carries its time in the film.
 */
async function analyse(src, from, length) {
  const statsFile = path.join(CACHE_DIR, `stats-${process.pid}-${hash(src + from)}.txt`);
  await runMedia(
    'ffmpeg',
    [
      '-hide_banner', '-nostats',
      ...inputOptions(src),
      '-ss', from.toFixed(2), '-t', String(length), '-i', input(src),
      '-an',
      '-vf', `fps=3,scale=240:-2,select='gte(scene,0)',signalstats,metadata=print:file=${statsFile}`,
      '-f', 'null', '-',
    ],
    src,
  );
  const text = await readFile(statsFile, 'utf8').catch(() => '');
  await rm(statsFile, { force: true });
  const value = (block, key) => Number((block.match(new RegExp(`${key.replace(/\./g, '\\.')}=([\\d.]+)`)) || [])[1] || 0);
  return text
    .split(/^frame:/m)
    .slice(1)
    .map((block) => ({
      t: from + Number((block.match(/pts_time:([\d.]+)/) || [])[1] || 0),
      luma: value(block, 'lavfi.signalstats.YAVG'),
      sat: value(block, 'lavfi.signalstats.SATAVG'),
      scene: value(block, 'lavfi.scene_score'),
    }));
}

/** Higher is better: well lit, some colour, no dark cards, few hard cuts. */
function score(frames) {
  if (frames.length < 6) return -Infinity;
  const luma = mean(frames.map((f) => f.luma)) / 255;
  const dark = frames.filter((f) => f.luma < 40).length / frames.length;
  const colour = Math.min(mean(frames.map((f) => f.sat)), 40) / 40;
  const cuts = frames.filter((f) => f.scene > 0.4).length;
  return luma + 0.5 * colour - 1.6 * dark - 0.25 * cuts;
}

async function pickStart(film, info, picks) {
  const length = SEGMENT + FADE;
  if (typeof film.start === 'number') return Math.min(film.start, Math.max(0, info.duration - length));
  if (picks[film.key] !== undefined) return picks[film.key];
  if (info.duration < length * 2.5) return Math.max(0, (info.duration - length) / 2);

  // Short clips (trailers): scan everything between the opening logos and the closing titles.
  // Feature films: scan three 90-second stretches spread through the film.
  const stretches =
    info.duration < 300
      ? [[info.duration * 0.12, info.duration * 0.8]]
      : [0.28, 0.48, 0.66].map((f) => [info.duration * f, info.duration * f + STRETCH]);
  let best = { at: stretches[0][0], score: -Infinity };
  for (const [from, to] of stretches) {
    let frames;
    try {
      frames = await analyse(film.preview || film.src, from, to - from);
      process.stdout.write('.');
    } catch {
      process.stdout.write('x');
      continue;
    }
    // Slide a window through the stretch, one second at a time.
    for (let at = from; at + length <= to; at += 1) {
      const s = score(frames.filter((f) => f.t >= at && f.t < at + length));
      if (s > best.score) best = { at, score: s };
    }
  }
  process.stdout.write(' ');
  return best.at;
}

/* ---------- rendering ---------- */

/** Fit any picture onto the 2.2:1 screen: crop up to MAX_CROP to fill it, letterbox whatever is left. */
function fitFilter(aspect) {
  const target = WIDTH / HEIGHT;
  const square = 'scale=iw*sar:ih,setsar=1';
  if (aspect < target) {
    const shown = MAX_CROP >= 1 ? target : Math.min(target, aspect / (1 - MAX_CROP));
    return `${square},crop=iw:iw/${shown.toFixed(5)},scale=${even(HEIGHT * shown)}:${HEIGHT},pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
  }
  const shown = Math.max(target, aspect * (1 - MAX_CROP));
  return `${square},crop=ih*${shown.toFixed(5)}:ih,scale=${WIDTH}:${even(WIDTH / shown)},pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
}

async function renderSegment(film, info, start) {
  const length = SEGMENT + FADE;
  const out = path.join(CACHE_DIR, `segment-${hash(`${film.src}|${start}|${WIDTH}x${HEIGHT}|${length}|fill-v3`)}.mp4`);
  if (existsSync(out)) return out;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...inputOptions(film.src), '-ss', start.toFixed(3), '-t', String(length), '-i', input(film.src)];
  if (!info.hasAudio) args.push('-f', 'lavfi', '-t', String(length), '-i', 'anullsrc=r=48000:cl=stereo');
  const audioIn = info.hasAudio ? '0:a:0' : '1:a';
  args.push(
    '-filter_complex',
    `[0:v:0]${fitFilter(info.aspect)},fps=${FPS},format=yuv420p,setsar=1[v];` +
      `[${audioIn}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-20:TP=-2:LRA=9,aresample=48000[a]`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(length),
    '-c:v', 'libx264', '-crf', '15', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '192k',
    out,
  );
  await runMedia('ffmpeg', args, film.src);
  return out;
}

async function join(segments, out) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const s of segments) args.push('-i', s);
  let graph = '';
  let video = '[0:v]';
  let audio = '[0:a]';
  for (let k = 1; k < segments.length; k++) {
    graph += `${video}[${k}:v]xfade=transition=fade:duration=${FADE}:offset=${k * SEGMENT}[v${k}];`;
    graph += `${audio}[${k}:a]acrossfade=d=${FADE}[a${k}];`;
    video = `[v${k}]`;
    audio = `[a${k}]`;
  }
  const total = segments.length * SEGMENT + FADE;
  const edge = 0.8; // fade from / to black where the reel loops
  graph += `${video}fade=t=in:st=0:d=${edge},fade=t=out:st=${total - edge}:d=${edge}[vout];`;
  graph += `${audio}afade=t=in:st=0:d=${edge},afade=t=out:st=${total - edge}:d=${edge}[aout]`;
  args.push(
    '-filter_complex', graph,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '21', '-preset', 'slow', '-tune', 'film', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    out,
  );
  await run('ffmpeg', args);
  return total;
}

/* ---------- main ---------- */

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(SOURCES_DIR, { recursive: true });
  relay = await startRelay();

  const listed = JSON.parse(await readFile(path.join(REEL_DIR, 'films.json'), 'utf8'));
  const local = (await readdir(SOURCES_DIR)).filter((f) => VIDEO_FILE.test(f)).sort((a, b) => a.localeCompare(b));

  const films = [
    ...local.map((file) => ({ title: titleFromFile(file), src: path.join(SOURCES_DIR, file), key: `file:${file}` })),
    ...listed.map((f) => ({ ...f, key: f.src })),
  ];
  if (!films.length) throw new Error('No films: add files to reel/sources/ or entries to reel/films.json');

  const picksFile = path.join(CACHE_DIR, 'picks.json');
  const picks = existsSync(picksFile) ? JSON.parse(await readFile(picksFile, 'utf8')) : {};

  const segments = [];
  const programme = [];
  for (const film of films) {
    process.stdout.write(`• ${film.title}${film.year ? ` (${film.year})` : ''}  `);
    try {
      const info = await probe(film.src);
      const start = await pickStart(film, info, picks);
      picks[film.key] = start;
      segments.push(await renderSegment(film, info, start));
      programme.push({ title: film.title, year: film.year, credit: film.credit, from: film.src.startsWith('http') ? 'web' : 'file', start: Math.round(start) });
      console.log(`→ ${clock(start)}`);
    } catch (err) {
      console.log(`skipped (${err.message.split('\n')[0]})`);
    }
  }
  await writeFile(picksFile, JSON.stringify(picks, null, 2));
  relay.close();
  if (!segments.length) throw new Error('Nothing could be rendered.');

  console.log(`\nJoining ${segments.length} films…`);
  const duration = await join(segments, path.join(OUT_DIR, 'reel.mp4'));
  const manifest = {
    segmentSeconds: SEGMENT,
    fadeSeconds: FADE,
    duration,
    films: programme.map(({ title, year, credit }, k) => ({ title, year, credit, at: k * SEGMENT })),
  };
  await writeFile(path.join(OUT_DIR, 'reel.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Done: src/reel/reel.mp4 (${duration}s, ${segments.length} films)`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
