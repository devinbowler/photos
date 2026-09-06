# photos

Photo hosting for devinbowler.com/photos. Anyone can look, only I can upload.

- `index.html`, `styles.css`, `app.js`, `config.js` — the static frontend, served by GitHub Pages
- `backend/` — Express API deployed on Render

## How the access works

There is no login. The Upload button asks for a password, and a correct one gets
a token that is good for 30 minutes, kept in sessionStorage. While that token is
alive I can upload, write captions, and create or delete albums. When it expires
the page goes back to being read-only.

Albums are public or private. A private album has its own separate password,
shared with whoever should see it, and unlocking one gives a signed token good
for 12 hours. Photos in a private album are never included in the public gallery
feed, even if they were marked for it before the album was made private.

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
