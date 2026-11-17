# Your films

Drop video files here (`.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`), then run:

```bash
npm run reel
```

Each file gets 10 seconds in the reel, ahead of the free films. The script picks the moment itself,
avoiding black frames, dark title cards and fast trailer-style cutting. Titles come from the file name,
and a leading number only sets the order: `1-the-batman.mp4` shows as "The Batman".

To choose the moment yourself, add an entry to `reel/films.json`:

```json
{ "title": "The Batman", "src": "reel/sources/1-the-batman.mp4", "start": 95 }
```

Files in this folder are not committed to git. Only use footage you have the rights to show.
