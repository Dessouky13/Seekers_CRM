# Why `vercel.json` looks the way it does

`vercel.json` is validated against a strict schema that rejects unknown
properties, so it cannot carry comments — not even the `"//"` key convention.
The reasoning lives here instead.

## The rewrite excludes `/assets/`

```json
{ "source": "/((?!assets/).*)", "destination": "/index.html" }
```

It used to be `/(.*)`, which matched everything.

Vercel applies rewrites *after* the filesystem check, so an existing file is
served normally and only a miss falls through to the rewrite. That sounds safe,
but the miss case is the problem: a browser holding a cached `index.html` asks
for the chunk hashes that page was built with, and after a deploy those files
are gone. The request fell through to the rewrite and came back **200 with
`Content-Type: text/html`** instead of 404. The browser then tried to parse HTML
as a JavaScript module, the dynamic import threw, and the route rendered
nothing — the app shell appeared with no page content.

This never showed while the app shipped as a single bundle: `index.html` always
named the one current hash, and any stale request was for a file still on disk.
Splitting the routes into per-page hashed chunks made every page a separate
artefact and turned it into a real failure mode.

With `/assets/` excluded, a stale chunk 404s honestly. That is what the
`vite:preloadError` handler in `src/main.tsx` listens for so it can reload the
tab once and pick up the current `index.html`.

If you add another build-output directory alongside `assets/`, exclude it here
too, or it will inherit the same bug.

## Cache-Control is split by path

Everything was previously served `max-age=0, must-revalidate`, including the
content-hashed chunks — so every asset was revalidated on every load despite
having a filename that can never change meaning.

- `/assets/(.*)` → `immutable`, one year. Safe because the filename contains a
  content hash; a new build produces a new name.
- `/` and `/index.html` → `must-revalidate`. This file names the current chunk
  hashes, so a stale copy is exactly what causes the failure above.
