# photos

Photo hosting for devinbowler.com/photos. Anyone can look, only I can upload.

- `index.html`, `styles.css`, `app.js`, `config.js` — the static frontend, served by GitHub Pages
- `backend/` — Express API deployed on Render

## How the access works

There is no login. The Upload button asks for a password, and a correct one gets
a token that is good for 30 minutes, kept in sessionStorage. While that token is
alive I can upload, write captions, and create or delete albums. When it expires
the page goes back to being read-only.

Photos are not added to the public gallery unless I tick the box at upload
time, and any single photo can be added or removed from the gallery later
from its full-size view without affecting which album it sits in.

Uploads go up in batches of four. The server holds each batch in memory
before sending it on to Cloudinary, so batching keeps peak memory flat no
matter how many photos are selected, and a failed batch reports itself and
offers a retry of just those files rather than losing the whole run.

The gallery and each album both have an Edit button that turns on reordering
and selection. The two orders are stored separately, so arranging the gallery
does not disturb an album a photo also belongs to. In the gallery, photos I
have not placed by hand sort newest first and sit above the arranged ones, so
newly published photos appear at the top without disturbing what I dragged.

Inside an album, Edit turns on reordering and selection. Dragging a photo
moves it and the new order is saved to the album straight away; a click
without movement selects instead, and selected photos can be moved to
another album or deleted together. Album order is stored per photo, so
photos uploaded before ordering existed get positions the first time their
album is opened, based on the date order they were already in.

A photo can be downloaded from its full-size view, and selected photos can be
downloaded together from Edit mode, which comes back as one zip. Downloads are
always jpeg at native resolution and maximum quality, so a HEIC original comes
back as something any machine can open. Cloudinary builds the zip, so nothing
large is streamed through the backend.

Cloudinary stores the uploaded file untouched, so the originals are never
degraded. The full-size view is served at native resolution with quality set
to maximum, which is a re-encode but not a visible one; `f_auto` stays in the
chain because a browser cannot display a HEIC file without it. The untouched
file is still at the `original` URL on every photo.

Opening a photo does not wait on a download. Every photo in a view has its
1400px stand-in fetched up front, four at a time, which is a few hundred KB
each and means any photo on the page opens the moment it is clicked. The full
file follows and replaces it in place. Hovering a tile also starts fetching
its full size, so on a desktop a photo has usually skipped the stand-in stage
entirely by the time it is opened. On a connection reporting itself as slow or
metered, warming drops to the first twelve photos instead. Every photo in the current view
has a mid-size preview fetched quietly in the background, so the lightbox
always has something correct to paint immediately, and the full size for the
photos either side is fetched ahead of the arrow keys. Selected photos can
also be made public or private in bulk.

Only photos that are in the public gallery carry a badge, and only inside
an album, since everything in the gallery is public by definition.

Albums are public or private. A private album has its own separate password,
shared with whoever should see it, and unlocking one gives a signed token good
for 12 hours.

Whether a photo appears in the public gallery is the photo's own setting and
nothing overrides it. A photo can sit in a private album and still be published
to the gallery, in which case it appears in both places: the album stays behind
its password, and that one photo is public. Making an album private offers to
take its photos out of the gallery, ticked by default, but that is a choice
rather than something that happens silently.

## Backend environment variables

See `backend/.env.example`. On Render, set:

| Variable | What it is |
| --- | --- |
| `MONGODB_URI` | Mongo connection string |
| `APP_PASSWORD` | The password that unlocks uploading |
| `TOKEN_SECRET` | Random string used to sign album tokens |
| `CLOUDINARY_CLOUD_NAME` | From the Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From the Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From the Cloudinary dashboard |

Root directory on Render is `backend`, build is `npm install`, start is `npm start`.

## Frontend

GitHub Pages serves this repo's root on the `main` branch, which lands at
devinbowler.com/photos because the devinbowler.github.io repo claims that
domain. No build step. `API_URL` in `config.js` points at the Render service.

## Running locally

    cd backend && npm install && npm start

Then serve the repo root with any static server and point `config.js` at
`http://localhost:3000`.
