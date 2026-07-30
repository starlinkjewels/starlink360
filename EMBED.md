# Embedding the viewer

Point an iframe at the viewer with the model's URL in the query string. The
viewer downloads and renders the file in the browser — there is no upload step
and no server involved on our side.

```html
<iframe
  src="https://viewer.example.com/?file=https%3A%2F%2Fyour-app.com%2Ffiles%2FLP043.3dm&embed=true"
  style="width: 100%; height: 80vh; border: 0"
  allow="fullscreen"
></iframe>
```

## Parameters

| Parameter | Required | Description                                                                             |
| --------- | -------- | --------------------------------------------------------------------------------------- |
| `file`    | yes      | URL of a `.3dm`, `.glb` or `.gltf`. **Must be URL-encoded.** Relative paths also work.  |
| `embed`   | no       | `true` hides the brand header and the upload button. Use it inside an iframe.           |
| `name`    | no       | Piece name to display. Defaults to the filename.                                        |
| `ref`     | no       | Reference / SKU line. Defaults to the filename.                                         |
| `key`     | no       | `bhumit` reveals the upload button. Omit it and there is no way to load a file by hand. |

Encode `file` — a raw URL containing `?` or `&` will be cut short:

```js
const src = `https://viewer.example.com/?file=${encodeURIComponent(modelUrl)}&embed=true`;
```

`embed=true` is the exact form to use. `1`, `yes` and `on` also work but cost a
redirect, because the router normalises them.

## The upload button

Hidden everywhere by default — on the plain `/` route and behind a `?file=` link
alike — so a client-facing link shows the piece it was given and nothing else.

Add `?key=bhumit` to get it back for your own use.

This is obscurity, not security: the key travels in the address bar, so anyone
sent such a link can use it. That is fine for hiding a control; do not rely on it
to protect anything.

## The one requirement on your side: CORS

The visitor's browser fetches the model directly from your server, so **your
file URL must allow it**:

```
Access-Control-Allow-Origin: *
```

Without that header the browser blocks the download and refuses to say why — the
viewer will show "the model could not be downloaded". This is the single most
common reason an integration fails. If you serve files from S3, CloudFront or
Azure Blob, this is a bucket/distribution CORS setting.

Signed, expiring download URLs are fine. The extension can be missing from the
path (`/api/files/8fa21c/download` works) — `.3dm` is assumed.

### Firebase Storage / Google Cloud Storage

A Firebase download URL **will not work until the bucket has a CORS rule.** This
catches everyone, because the URL downloads perfectly in a browser tab and in
curl — it only fails from JavaScript. Firebase answers the CORS _preflight_ with
`Access-Control-Allow-Origin: *` but omits it from the actual file response,
which is the one the browser checks.

Save this as `cors.json`:

```json
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length", "Content-Range", "Content-Disposition"],
    "maxAgeSeconds": 3600
  }
]
```

Apply it once per bucket:

```sh
gcloud storage buckets update gs://YOUR-BUCKET --cors-file=cors.json
# or, with the older tool:
gsutil cors set cors.json gs://YOUR-BUCKET
```

Then confirm the header is really on the file response — not just the preflight:

```sh
curl -sI -H "Origin: https://your-viewer" "YOUR_FILE_URL" | grep -i access-control-allow-origin
```

If that prints nothing, the browser will still block it. Narrow `origin` from
`*` to the viewer's domain once it is live.

## What the visitor gets

Whatever the viewer already does: 360° turntable, tap-to-focus, live metal
finishes, and the studio panel for downloading HD stills and MP4 turntables. All
of it runs client-side, so no GPU or backend is needed.

## Notes and limits

- **First load of a large `.3dm` takes time.** A 75 MB file is roughly 10
  seconds of decoding after the download, with a progress bar throughout. `.glb`
  is near-instant, so pre-converting is worth it if you can.
- **Changing `file` reloads the piece.** Navigating the iframe to a new `file`
  swaps the model and cancels any download still in flight.
- **The upload button is hidden when `embed=true`**, so a visitor cannot replace
  the piece your system chose.
- **Framing is open to any site.** The viewer holds no login or session, so
  there is nothing for a hostile framer to capture. If sign-in is ever added,
  this must be narrowed to an allowlist of partner origins — see
  `allowEmbedding` in `src/server.ts`.
- **Dark theme by default**, with a light option in the studio panel. The
  visitor's choice is remembered per browser.
