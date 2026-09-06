/* devinbowler.com/photos */

const API = (window.CONFIG && window.CONFIG.API_URL) || '';

const state = {
  view: 'gallery',       // gallery | albums | album
  albumSlug: null,
  cols: Number(localStorage.getItem('photos.cols')) || 4,
  owner: null,           // { token, expiresAt }
  photos: [],
  albums: [],
  lightboxIndex: -1,
  editing: false,
  selected: new Set()
};

const el = {
  main: document.getElementById('main'),
  tabs: document.getElementById('tabs'),
  backLink: document.getElementById('backLink'),
  density: document.getElementById('density'),
  uploadBtn: document.getElementById('uploadBtn'),
  sessionPill: document.getElementById('sessionPill'),
  lightbox: document.getElementById('lightbox'),
  lbImage: document.getElementById('lbImage'),
  lbCaptionCard: document.getElementById('lbCaptionCard'),
  lbCaption: document.getElementById('lbCaption'),
  lbMeta: document.getElementById('lbMeta'),
  lbOwnerTools: document.getElementById('lbOwnerTools'),
  lbCaptionInput: document.getElementById('lbCaptionInput'),
  lbInGallery: document.getElementById('lbInGallery'),
  lbSaveCaption: document.getElementById('lbSaveCaption'),
  lbDelete: document.getElementById('lbDelete'),
  lbClose: document.getElementById('lbClose'),
  lbDownload: document.getElementById('lbDownload'),
  lbPrev: document.getElementById('lbPrev'),
  lbNext: document.getElementById('lbNext'),
  modal: document.getElementById('modal'),
  modalCard: document.getElementById('modalCard'),
  toast: document.getElementById('toast')
};

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i;

// Windows Chrome reports .heic with an empty MIME type, so check the filename too
function isImage(file) {
  if (file.type && file.type.startsWith('image/')) return true;
  if (!file.type || file.type === 'application/octet-stream') return IMAGE_EXTENSIONS.test(file.name);
  return false;
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (state.owner) headers.Authorization = `Bearer ${state.owner.token}`;
  if (options.albumToken) headers['X-Album-Token'] = options.albumToken;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }

  const res = await fetch(API + path, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  let data = {};
  try { data = await res.json(); } catch (err) { /* empty body is fine */ }

  if (!res.ok) {
    if (res.status === 401 && state.owner && !data.locked) {
      clearOwner();
    }
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Owner session (30 minute token)
 * ------------------------------------------------------------------ */

function loadOwner() {
  try {
    const raw = sessionStorage.getItem('photos.owner');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.expiresAt > Date.now()) state.owner = parsed;
    else sessionStorage.removeItem('photos.owner');
  } catch (err) { /* ignore */ }
}

function setOwner(session) {
  state.owner = session;
  try { sessionStorage.setItem('photos.owner', JSON.stringify(session)); } catch (err) { /* ignore */ }
  renderSessionPill();
  render();
}

function clearOwner() {
  state.owner = null;
  try { sessionStorage.removeItem('photos.owner'); } catch (err) { /* ignore */ }
  renderSessionPill();
}

function isOwner() {
  if (!state.owner) return false;
  if (state.owner.expiresAt <= Date.now()) {
    clearOwner();
    toast('Session expired');
    render();
    return false;
  }
  return true;
}

function renderSessionPill() {
  if (!state.owner) {
    el.sessionPill.hidden = true;
    el.uploadBtn.textContent = 'Upload';
    return;
  }
  const minutes = Math.max(0, Math.ceil((state.owner.expiresAt - Date.now()) / 60000));
  el.sessionPill.hidden = false;
  el.sessionPill.textContent = `Unlocked · ${minutes}m`;
  el.uploadBtn.textContent = 'Upload';
}

setInterval(() => {
  if (state.owner) {
    if (state.owner.expiresAt <= Date.now()) {
      clearOwner();
      toast('Session expired');
      render();
    } else {
      renderSessionPill();
    }
  }
}, 20000);

function albumToken(slug) {
  try {
    const raw = sessionStorage.getItem(`photos.album.${slug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt > Date.now()) return parsed.token;
    sessionStorage.removeItem(`photos.album.${slug}`);
  } catch (err) { /* ignore */ }
  return null;
}

function saveAlbumToken(slug, token, expiresAt) {
  try {
    sessionStorage.setItem(`photos.album.${slug}`, JSON.stringify({ token, expiresAt }));
  } catch (err) { /* ignore */ }
}

/* ------------------------------------------------------------------ *
 * Modal helpers
 * ------------------------------------------------------------------ */

function openModal(html) {
  el.modalCard.innerHTML = html;
  el.modal.hidden = false;
  const firstInput = el.modalCard.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 40);
}

function closeModal() {
  el.modal.hidden = true;
  el.modalCard.innerHTML = '';
}

el.modal.addEventListener('click', e => {
  if (e.target.dataset.close) closeModal();
});

function clearModalError() {
  const node = el.modalCard.querySelector('.modal-error');
  if (node) node.remove();
}

function modalError(message) {
  let node = el.modalCard.querySelector('.modal-error');
  if (!node) {
    node = document.createElement('p');
    node.className = 'modal-error';
    el.modalCard.appendChild(node);
  }
  node.textContent = message;
}

/* ------------------------------------------------------------------ *
 * Password prompt -> 30 minute token
 * ------------------------------------------------------------------ */

function promptForPassword(onSuccess) {
  openModal(`
    <h2>Enter password</h2>
    <p class="modal-sub">Unlocks uploading and editing for 30 minutes.</p>
    <form id="authForm">
      <div class="field">
        <input type="password" id="authPassword" placeholder="Password" autocomplete="current-password">
      </div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
        <button class="btn btn-sm btn-primary" type="submit" id="authSubmit">Unlock</button>
      </div>
    </form>
  `);

  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const button = document.getElementById('authSubmit');
    const password = document.getElementById('authPassword').value;
    button.disabled = true;
    button.textContent = 'Checking...';
    try {
      const data = await api('/api/auth', { method: 'POST', json: { password } });
      setOwner({ token: data.token, expiresAt: data.expiresAt });
      closeModal();
      toast('Unlocked for 30 minutes');
      if (onSuccess) onSuccess();
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Unlock';
      modalError(err.message);
    }
  });
}

function withOwner(action) {
  if (isOwner()) action();
  else promptForPassword(action);
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

function openUploadModal(presetAlbum) {
  const albumOptions = state.albums
    .map(a => `<option value="${esc(a.slug)}"${a.slug === presetAlbum ? ' selected' : ''}>${esc(a.name)}${a.visibility === 'private' ? ' (private)' : ''}</option>`)
    .join('');

  openModal(`
    <h2>Upload photos</h2>
    <p class="modal-sub">JPEG, PNG, HEIC, WebP. Select as many as you like.</p>

    <div class="dropzone" id="dropzone">
      <strong>Choose photos</strong>
      or drag them here
    </div>
    <input type="file" id="fileInput" accept="image/*,.heic,.heif,.HEIC,.HEIF,.avif,.AVIF" multiple hidden>
    <div class="file-list" id="fileList"></div>

    <div class="field">
      <label for="albumSelect">Add to</label>
      <select id="albumSelect">
        <option value="">Gallery (no album)</option>
        ${albumOptions}
      </select>
    </div>

    <label class="checkline">
      <input type="checkbox" id="showInGallery">
      Also show these in the public gallery
    </label>
    <p class="field-hint">Off by default. A photo can be in a private album and still appear here, and you can change this per photo later.</p>

    <div class="progress" id="progressBar" hidden><span></span></div>

    <div class="modal-actions">
      <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
      <button class="btn btn-sm btn-primary" type="button" id="uploadSubmit" disabled>Upload</button>
    </div>
  `);

  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const fileList = document.getElementById('fileList');
  const submit = document.getElementById('uploadSubmit');
  let files = [];
  let lastBatchError = 'unknown error';

  function setFiles(list) {
    const all = Array.from(list);
    const picked = all.filter(isImage);
    const skipped = all.filter(f => !isImage(f));

    files = picked;

    // A long selection would make a huge DOM list, so summarise past a point
    if (files.length <= 12) {
      fileList.innerHTML = files
        .map(f => `<div>${esc(f.name)} <span style="color:var(--text-muted)">${(f.size / 1024 / 1024).toFixed(1)} MB</span></div>`)
        .join('');
    } else {
      const mb = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;
      fileList.innerHTML = `<div>${files.length} photos selected <span style="color:var(--text-muted)">${mb.toFixed(0)} MB total</span></div>`;
    }

    if (skipped.length) modalError(`${skipped.length} file${skipped.length === 1 ? '' : 's'} skipped, not an image`);
    else clearModalError();

    submit.disabled = files.length === 0;
    submit.textContent = files.length ? `Upload ${files.length}` : 'Upload';
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => setFiles(fileInput.files));
  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  }));
  dropzone.addEventListener('drop', e => setFiles(e.dataTransfer.files));

  // Photos go up a few at a time. The server holds each batch in memory, so a
  // small batch keeps peak memory well under the instance limit no matter how
  // many photos are selected, and a failure only costs that batch.
  const BATCH_SIZE = 4;

  function uploadBatch(batch, album, showInGallery, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      batch.forEach(f => form.append('files', f));
      if (album) form.append('album', album);
      form.append('showInGallery', String(showInGallery));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', API + '/api/photos');
      xhr.setRequestHeader('Authorization', `Bearer ${state.owner.token}`);
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let message = `Upload failed (${xhr.status})`;
        try { message = JSON.parse(xhr.responseText).error || message; } catch (err) { /* keep default */ }
        reject(new Error(message));
      });
      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
      xhr.send(form);
    });
  }

  submit.addEventListener('click', async () => {
    const album = document.getElementById('albumSelect').value;
    const showInGallery = document.getElementById('showInGallery').checked;
    const progress = document.getElementById('progressBar');
    const bar = progress.querySelector('span');
    const total = files.length;

    submit.disabled = true;
    progress.hidden = false;
    clearModalError();

    let uploaded = 0;
    const failed = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      submit.textContent = total > BATCH_SIZE
        ? `Uploading ${uploaded + 1}-${Math.min(uploaded + batch.length, total)} of ${total}`
        : 'Uploading...';

      try {
        await uploadBatch(batch, album, showInGallery, fraction => {
          const overall = (uploaded + fraction * batch.length) / total;
          bar.style.width = `${Math.round(overall * 100)}%`;
        });
      } catch (err) {
        batch.forEach(f => failed.push(f.name));
        lastBatchError = err.message;
      }

      uploaded += batch.length;
      bar.style.width = `${Math.round((uploaded / total) * 100)}%`;
    }

    const ok = total - failed.length;

    if (failed.length === 0) {
      closeModal();
      toast(`Uploaded ${ok} photo${ok === 1 ? '' : 's'}`);
      render();
      return;
    }

    // Some went up, some did not. Keep the modal open and say exactly what happened.
    progress.hidden = true;
    submit.disabled = false;
    submit.textContent = `Retry ${failed.length}`;
    files = files.filter(f => failed.includes(f.name));
    modalError(`${ok} uploaded, ${failed.length} failed (${lastBatchError}). Press retry to try the rest again.`);
    render();
  });
}

/* ------------------------------------------------------------------ *
 * Album modals
 * ------------------------------------------------------------------ */

function openAlbumModal(existing) {
  const isEdit = Boolean(existing);
  openModal(`
    <h2>${isEdit ? 'Edit album' : 'New album'}</h2>
    <p class="modal-sub">${isEdit ? 'Change the name or who can see it.' : 'Private albums need a password to open.'}</p>
    <form id="albumForm">
      <div class="field">
        <label for="albumName">Name</label>
        <input type="text" id="albumName" value="${isEdit ? esc(existing.name) : ''}" placeholder="Summer 2026">
      </div>
      <div class="field">
        <label for="albumVisibility">Visibility</label>
        <select id="albumVisibility">
          <option value="public"${isEdit && existing.visibility === 'public' ? ' selected' : ''}>Public — anyone with the link</option>
          <option value="private"${isEdit && existing.visibility === 'private' ? ' selected' : ''}>Private — password required</option>
        </select>
      </div>
      <div class="field" id="passwordField" hidden>
        <label for="albumPassword">Album password</label>
        <input type="password" id="albumPassword" placeholder="${isEdit ? 'Leave blank to keep the current one' : 'Password for this album'}">
        <p class="field-hint">Separate from your upload password. Share this one with whoever should see it.</p>
      </div>
      <div id="hidePhotosField" hidden>
        <label class="checkline">
          <input type="checkbox" id="hidePhotos" checked>
          Also take these photos out of the public gallery
        </label>
        <p class="field-hint">The password hides the album. Photos individually marked public stay in the gallery unless you untick this.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
        <button class="btn btn-sm btn-primary" type="submit" id="albumSubmit">${isEdit ? 'Save' : 'Create album'}</button>
      </div>
    </form>
  `);

  const visibility = document.getElementById('albumVisibility');
  const passwordField = document.getElementById('passwordField');
  const hidePhotosField = document.getElementById('hidePhotosField');
  const syncPasswordField = () => {
    passwordField.hidden = visibility.value !== 'private';
    // Only meaningful when an album that already has photos becomes private
    hidePhotosField.hidden = !(isEdit && visibility.value === 'private' && existing.visibility !== 'private');
  };
  visibility.addEventListener('change', syncPasswordField);
  syncPasswordField();

  document.getElementById('albumForm').addEventListener('submit', async e => {
    e.preventDefault();
    const button = document.getElementById('albumSubmit');
    const name = document.getElementById('albumName').value.trim();
    const vis = visibility.value;
    const password = document.getElementById('albumPassword').value;

    if (!name) return modalError('Give the album a name');
    if (vis === 'private' && !password && !isEdit) return modalError('Private albums need a password');

    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const payload = { name, visibility: vis };
      if (password) payload.password = password;
      const hide = document.getElementById('hidePhotos');
      if (hide && !hidePhotosField.hidden) payload.hidePhotos = hide.checked;
      if (isEdit) await api(`/api/albums/${existing.slug}`, { method: 'PATCH', json: payload });
      else await api('/api/albums', { method: 'POST', json: payload });
      closeModal();
      toast(isEdit ? 'Album updated' : 'Album created');
      render();
    } catch (err) {
      button.disabled = false;
      button.textContent = isEdit ? 'Save' : 'Create album';
      modalError(err.message);
    }
  });
}

function confirmDeleteAlbum(album) {
  openModal(`
    <h2>Delete “${esc(album.name)}”?</h2>
    <p class="modal-sub">${album.count} photo${album.count === 1 ? '' : 's'} in this album.</p>
    <label class="checkline">
      <input type="checkbox" id="keepPhotos">
      Keep the photos, just remove the album
    </label>
    <p class="field-hint">Unchecked, the photos are deleted from Cloudinary too. That cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
      <button class="btn btn-sm btn-primary" type="button" id="confirmDelete">Delete</button>
    </div>
  `);

  document.getElementById('confirmDelete').addEventListener('click', async () => {
    const keep = document.getElementById('keepPhotos').checked;
    const button = document.getElementById('confirmDelete');
    button.disabled = true;
    button.textContent = 'Deleting...';
    try {
      await api(`/api/albums/${album.slug}?keepPhotos=${keep}`, { method: 'DELETE' });
      closeModal();
      toast('Album deleted');
      if (state.view === 'album' && state.albumSlug === album.slug) location.hash = '#albums';
      else render();
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Delete';
      modalError(err.message);
    }
  });
}

function promptAlbumPassword(album) {
  openModal(`
    <h2>${esc(album.name)}</h2>
    <p class="modal-sub">This album is private. Enter its password to view.</p>
    <form id="unlockForm">
      <div class="field">
        <input type="password" id="unlockPassword" placeholder="Album password">
      </div>
      <div class="modal-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
        <button class="btn btn-sm btn-primary" type="submit" id="unlockSubmit">Open album</button>
      </div>
    </form>
  `);

  document.getElementById('unlockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const button = document.getElementById('unlockSubmit');
    button.disabled = true;
    button.textContent = 'Checking...';
    try {
      const data = await api(`/api/albums/${album.slug}/unlock`, {
        method: 'POST',
        json: { password: document.getElementById('unlockPassword').value }
      });
      if (data.token) saveAlbumToken(album.slug, data.token, data.expiresAt);
      closeModal();
      location.hash = `#album/${album.slug}`;
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Open album';
      modalError(err.message);
    }
  });
}


/* ------------------------------------------------------------------ *
 * Image preloading
 *
 * Opening a photo used to wait on a full-size download. Now every photo in
 * the current view gets its mid-size preview fetched quietly in the
 * background, so the lightbox has something correct to paint immediately,
 * and the full size for the photos either side is fetched ahead of time so
 * the arrow keys do not wait on the network.
 * ------------------------------------------------------------------ */

const imageCache = new Map(); // url -> Promise, also keeps the Image alive
const imageReady = new Set(); // urls that have actually finished loading
const PREVIEW_CONCURRENCY = 4;
// Full-size images are native resolution and worth several megabytes each, so
// they are fetched narrowly: the neighbours, and whatever the cursor is on.
const NEIGHBOURS_AHEAD = 1;
// Every photo in a view gets its stand-in fetched, so any of them opens
// instantly. Stand-ins are a few hundred KB, so a normal album is a handful of
// megabytes. The cap only exists to stop something pathological.
const WARM_LIMIT = 400;

function preload(url) {
  if (!url) return Promise.resolve();
  if (imageCache.has(url)) return imageCache.get(url);

  const p = new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { imageReady.add(url); resolve(img); };
    img.onerror = () => resolve(null); // a miss should never break navigation
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

function isReady(url) {
  return imageReady.has(url);
}

// Walk the list a few at a time so a big album does not open 200 connections
// Respect a metered or slow connection rather than pulling an album over it
function connectionIsCheap() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return true;                       // no information, assume normal
  if (c.saveData) return false;              // the user asked for less data
  if (c.effectiveType && /^(slow-2g|2g|3g)$/.test(c.effectiveType)) return false;
  return true;
}

let warmToken = 0;
async function warmPreviews(photos) {
  const token = ++warmToken;
  const budget = connectionIsCheap() ? WARM_LIMIT : 12;
  const queue = photos.slice(0, budget).map(p => p.preview || p.full).filter(Boolean);
  let i = 0;

  async function worker() {
    while (i < queue.length) {
      if (token !== warmToken) return; // the view changed, stop working
      const url = queue[i++];
      await preload(url);
    }
  }

  await Promise.all(Array.from({ length: PREVIEW_CONCURRENCY }, worker));
}

function warmNeighbours(index) {
  const n = state.photos.length;
  if (!n) return;

  // Previews reach a bit further than full sizes: they are small, and having
  // one ready is the difference between an instant paint and a blank frame.
  for (let step = 1; step <= 3; step++) {
    const next = state.photos[(index + step) % n];
    const prev = state.photos[(index - step + n) % n];
    if (next) preload(next.preview);
    if (prev) preload(prev.preview);
  }

  for (let step = 1; step <= NEIGHBOURS_AHEAD; step++) {
    const next = state.photos[(index + step) % n];
    const prev = state.photos[(index - step + n) % n];
    if (next) preload(next.full);
    if (prev) preload(prev.full);
  }
}

// A click is almost always preceded by the cursor arriving, so start fetching
// then. By the time the photo is actually opened the file is usually in hand.
function warmOnHover(tile) {
  const photo = state.photos[Number(tile.dataset.index)];
  if (!photo) return;
  preload(photo.preview);
  preload(photo.full);
}


// The download URLs carry Content-Disposition from Cloudinary, so a plain
// link is enough and nothing has to be proxied through the backend.
function saveFile(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// A web page cannot write to the camera roll, but handing the file to the
// system share sheet gets there in one tap: iOS offers "Save Image" and
// Android offers the gallery. Falls back to an ordinary download.
function canShareFiles() {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function';
}

async function savePhotoToDevice(photo) {
  const url = photo.download || photo.original;
  const name = `${(photo.caption || 'photo').replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'photo'}.jpg`;

  if (canShareFiles()) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const file = new File([blob], name, { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return 'shared';
        }
      }
    } catch (err) {
      // A cancelled share sheet lands here too, and should not then start a
      // download the user just declined.
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }

  saveFile(url);
  return 'downloaded';
}

/* ------------------------------------------------------------------ *
 * Lightbox
 * ------------------------------------------------------------------ */

function openLightbox(index) {
  state.lightboxIndex = index;
  const photo = state.photos[index];
  if (!photo) return;

  showPhoto(photo);
  el.lbImage.alt = photo.caption || 'Photo';
  const caption = photo.caption || '';
  const meta = formatDate(photo.takenAt || photo.uploadedAt);
  el.lbCaption.textContent = caption;
  el.lbMeta.textContent = meta;
  // An empty card is just a floating grey box over the photo
  el.lbCaptionCard.hidden = !caption && !meta;

  const owner = isOwner();
  el.lbOwnerTools.hidden = !owner;
  if (owner) {
    el.lbCaptionInput.value = photo.caption || '';
    el.lbInGallery.checked = !!photo.showInGallery;
  }

  const many = state.photos.length > 1;
  el.lbPrev.hidden = !many;
  el.lbNext.hidden = !many;

  el.lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  warmNeighbours(index);
}

function closeLightbox() {
  el.lightbox.hidden = true;
  el.lbImage.src = '';
  state.lightboxIndex = -1;
  document.body.style.overflow = '';
}

// Paint the best image already in hand, then upgrade to the full size when it
// arrives, provided the user has not moved on in the meantime.
function showPhoto(photo) {
  el.lbImage.dataset.photoId = photo.id;
  if (isReady(photo.full)) {
    el.lbImage.classList.remove('is-preview');
    el.lbImage.src = photo.full;
  } else if (isReady(photo.preview)) {
    el.lbImage.classList.add('is-preview');
    el.lbImage.src = photo.preview;
  } else {
    el.lbImage.classList.add('is-preview');
    el.lbImage.src = photo.preview || photo.full;
  }

  const wanted = photo.id;
  preload(photo.full).then(() => {
    const current = state.photos[state.lightboxIndex];
    if (!current || current.id !== wanted) return; // moved on already
    el.lbImage.src = photo.full;
    el.lbImage.classList.remove('is-preview');
  });
}

function step(delta) {
  if (state.lightboxIndex < 0 || state.photos.length === 0) return;
  const next = (state.lightboxIndex + delta + state.photos.length) % state.photos.length;
  openLightbox(next);
}

el.lightbox.addEventListener('click', e => {
  if (e.target.dataset.close) closeLightbox();
});
el.lbClose.addEventListener('click', closeLightbox);

el.lbDownload.addEventListener('click', async () => {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  el.lbDownload.disabled = true;
  try {
    const how = await savePhotoToDevice(photo);
    if (how === 'shared') toast('Choose Save Image to put it in your photos');
    else if (how === 'downloaded') toast('Downloading full resolution JPEG');
  } catch (err) {
    toast('Could not download that photo');
  } finally {
    el.lbDownload.disabled = false;
  }
});
el.lbPrev.addEventListener('click', () => step(-1));
el.lbNext.addEventListener('click', () => step(1));

document.addEventListener('keydown', e => {
  if (!el.lightbox.hidden) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    return;
  }
  if (!el.modal.hidden && e.key === 'Escape') closeModal();
});

// Removing a photo from the public gallery leaves it in its album untouched.
el.lbInGallery.addEventListener('change', async () => {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  const wanted = el.lbInGallery.checked;
  el.lbInGallery.disabled = true;
  try {
    await api(`/api/photos/${photo.id}`, { method: 'PATCH', json: { showInGallery: wanted } });
    photo.showInGallery = wanted;
    toast(wanted ? 'Now in the public gallery' : 'Removed from the public gallery');
    refreshTileFlag(state.lightboxIndex);
  } catch (err) {
    el.lbInGallery.checked = !wanted; // put it back, the server said no
    toast(err.message);
  } finally {
    el.lbInGallery.disabled = false;
  }
});

el.lbSaveCaption.addEventListener('click', async () => {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  const caption = el.lbCaptionInput.value.trim();
  el.lbSaveCaption.disabled = true;
  el.lbSaveCaption.textContent = 'Saving...';
  try {
    await api(`/api/photos/${photo.id}`, { method: 'PATCH', json: { caption } });
    photo.caption = caption;
    el.lbCaption.textContent = caption;
    el.lbCaptionCard.hidden = !caption && !el.lbMeta.textContent;
    toast('Caption saved');
    paintGrid();
  } catch (err) {
    toast(err.message);
  } finally {
    el.lbSaveCaption.disabled = false;
    el.lbSaveCaption.textContent = 'Save caption';
  }
});

el.lbDelete.addEventListener('click', async () => {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  if (!confirm('Delete this photo for good?')) return;
  try {
    await api(`/api/photos/${photo.id}`, { method: 'DELETE' });
    closeLightbox();
    toast('Photo deleted');
    render();
  } catch (err) {
    toast(err.message);
  }
});


/* ------------------------------------------------------------------ *
 * Selection bar and bulk actions
 * ------------------------------------------------------------------ */

function renderSelectBar() {
  const bar = document.getElementById('selectBar');
  if (!bar) return;
  const n = state.selected.size;
  bar.hidden = n === 0;
  if (n === 0) return;
  bar.querySelector('.count').textContent = `${n} selected`;
}

function clearSelection() {
  state.selected.clear();
  document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));
  renderSelectBar();
}

function selectedIds() {
  return Array.from(state.selected);
}

async function ensureAlbums() {
  if (state.albums.length) return;
  try {
    const data = await api('/api/albums');
    state.albums = data.albums;
  } catch (err) { /* the dialog still offers the gallery */ }
}

function openMoveModal() {
  const options = state.albums
    .filter(al => al.slug !== state.albumSlug)
    .map(al => `<option value="${esc(al.slug)}">${esc(al.name)}${al.visibility === 'private' ? ' (private)' : ''}</option>`)
    .join('');

  const n = state.selected.size;
  openModal(`
    <h2>Move ${n} photo${n === 1 ? '' : 's'}</h2>
    <p class="modal-sub">They keep their captions. Moving into a private album takes them out of the public gallery.</p>
    <div class="field">
      <label for="moveTarget">Move to</label>
      <select id="moveTarget">
        <option value="">Gallery (no album)</option>
        ${options}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
      <button class="btn btn-sm btn-primary" type="button" id="moveConfirm">Move</button>
    </div>
  `);

  document.getElementById('moveConfirm').addEventListener('click', async () => {
    const button = document.getElementById('moveConfirm');
    const target = document.getElementById('moveTarget').value || null;
    button.disabled = true;
    button.textContent = 'Moving...';
    try {
      const data = await api('/api/photos/bulk', {
        method: 'POST',
        json: { action: 'move', ids: selectedIds(), album: target }
      });
      closeModal();
      clearSelection();
      toast(`Moved ${data.count} photo${data.count === 1 ? '' : 's'}`);
      render();
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Move';
      modalError(err.message);
    }
  });
}

function openBulkDeleteModal() {
  const n = state.selected.size;
  openModal(`
    <h2>Delete ${n} photo${n === 1 ? '' : 's'}?</h2>
    <p class="modal-sub">This removes them from Cloudinary as well. It cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
      <button class="btn btn-sm btn-primary" type="button" id="bulkDeleteConfirm">Delete ${n}</button>
    </div>
  `);

  document.getElementById('bulkDeleteConfirm').addEventListener('click', async () => {
    const button = document.getElementById('bulkDeleteConfirm');
    button.disabled = true;
    button.textContent = 'Deleting...';
    try {
      const data = await api('/api/photos/bulk', { method: 'POST', json: { action: 'delete', ids: selectedIds() } });
      closeModal();
      clearSelection();
      toast(`Deleted ${data.count} photo${data.count === 1 ? '' : 's'}`);
      render();
    } catch (err) {
      button.disabled = false;
      button.textContent = `Delete ${n}`;
      modalError(err.message);
    }
  });
}

function selectBarHTML() {
  return `
    <div class="select-bar" id="selectBar" hidden>
      <span class="count">0 selected</span>
      <span class="spacer"></span>
      <button type="button" id="selectDownload">Download</button>
      <button type="button" id="selectPublic">Make public</button>
      <button type="button" id="selectPrivate">Make private</button>
      <button type="button" id="selectMove">Move to album</button>
      <button type="button" id="selectDelete" class="danger">Delete</button>
      <button type="button" id="selectClear">Clear</button>
    </div>
  `;
}

async function setSelectedVisibility(makePublic) {
  const ids = selectedIds();
  const buttons = document.querySelectorAll('#selectBar button');
  buttons.forEach(b => { b.disabled = true; });
  try {
    const data = await api('/api/photos/bulk', {
      method: 'POST',
      json: { action: makePublic ? 'public' : 'private', ids }
    });
    const word = makePublic ? 'public' : 'private';
    toast(`${data.count} photo${data.count === 1 ? '' : 's'} made ${word}`);
    clearSelection();
    render();
  } catch (err) {
    toast(err.message);
    buttons.forEach(b => { b.disabled = false; });
  }
}

async function downloadSelected() {
  const ids = selectedIds();
  const button = document.getElementById('selectDownload');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing...';
  try {
    const data = await api('/api/photos/download', { method: 'POST', json: { ids } });
    saveFile(data.url);
    toast(data.zip
      ? `Downloading ${data.count} photos as a zip`
      : 'Downloading full resolution JPEG');
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function wireSelectBar() {
  const move = document.getElementById('selectMove');
  const dl = document.getElementById('selectDownload');
  if (dl) dl.addEventListener('click', downloadSelected);
  const pub = document.getElementById('selectPublic');
  const priv = document.getElementById('selectPrivate');
  if (pub) pub.addEventListener('click', () => setSelectedVisibility(true));
  if (priv) priv.addEventListener('click', () => setSelectedVisibility(false));
  const del = document.getElementById('selectDelete');
  const clear = document.getElementById('selectClear');
  if (move) move.addEventListener('click', async () => { await ensureAlbums(); openMoveModal(); });
  if (del) del.addEventListener('click', openBulkDeleteModal);
  if (clear) clear.addEventListener('click', clearSelection);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function skeletons() {
  return `<div class="skeleton-grid" style="--cols:${state.cols}">${
    Array.from({ length: state.cols * 2 }, () => '<div class="skeleton"></div>').join('')
  }</div>`;
}

function photoGridHTML(photos) {
  return `<div class="grid" id="photoGrid" style="--cols:${state.cols}">${
    photos.map((p, i) => `
      <figure class="tile${state.editing ? ' editing' : ''}${state.selected.has(p.id) ? ' selected' : ''}" data-index="${i}" data-id="${esc(p.id)}">
        <img src="${esc(p.thumb)}" alt="${esc(p.caption || '')}" loading="lazy" draggable="false">
        ${p.caption && !state.editing ? `<figcaption class="tile-caption">${esc(p.caption)}</figcaption>` : ''}
        ${publicBadge(p)}
        ${state.editing ? '<span class="tile-check">\u2713</span>' : ''}
      </figure>
    `).join('')
  }</div>`;
}

// Inside an album most photos are private, so only the public ones are worth
// marking. In the gallery everything is public, so a badge there says nothing.
function publicBadge(photo) {
  const worthShowing = isOwner() && state.view === 'album' && photo.showInGallery;
  return worthShowing ? '<span class="tile-flag">Public</span>' : '';
}

function refreshTileFlag(index) {
  const tile = document.querySelector(`.tile[data-index="${index}"]`);
  if (!tile) return;
  const photo = state.photos[index];
  const existing = tile.querySelector('.tile-flag');
  const wanted = isOwner() && state.view === 'album' && photo && photo.showInGallery;
  if (wanted && !existing) {
    const flag = document.createElement('span');
    flag.className = 'tile-flag';
    flag.textContent = 'Public';
    tile.appendChild(flag);
  } else if (!wanted && existing) {
    existing.remove();
  }
}

function paintGrid() {
  const grid = document.getElementById('photoGrid');
  if (!grid) return;
  grid.style.setProperty('--cols', state.cols);
}

function wireGrid() {
  const grid = document.getElementById('photoGrid');
  if (!grid) return;
  grid.querySelectorAll('img').forEach(img => {
    if (img.complete) img.classList.add('loaded');
    else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  });

  grid.querySelectorAll('.tile').forEach(tile => {
    tile.addEventListener('pointerenter', () => warmOnHover(tile), { once: true });
  });

  if (!state.editing) {
    grid.querySelectorAll('.tile').forEach(tile => {
      tile.addEventListener('click', () => openLightbox(Number(tile.dataset.index)));
    });
    return;
  }

  wireEditGrid(grid);
}

/* ------------------------------------------------------------------ *
 * Edit mode: press and release selects, press and move reorders
 * ------------------------------------------------------------------ */

const DRAG_THRESHOLD = 6; // px of movement before a click becomes a drag

function wireEditGrid(grid) {
  grid.querySelectorAll('.tile').forEach(tile => {
    tile.addEventListener('pointerdown', e => beginPress(e, tile, grid));
  });
}

function beginPress(e, tile, grid) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();

  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let placeholderAfter = null;

  function onMove(ev) {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      tile.classList.add('dragging');
    }

    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = under && under.closest ? under.closest('.tile') : null;
    grid.querySelectorAll('.drop-target').forEach(t => t.classList.remove('drop-target'));
    if (!target || target === tile) return;

    target.classList.add('drop-target');

    // Insert before or after depending on which half of the target we are over
    const box = target.getBoundingClientRect();
    const after = ev.clientX > box.left + box.width / 2;
    placeholderAfter = after;
    if (after) target.after(tile);
    else target.before(tile);
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    grid.querySelectorAll('.drop-target').forEach(t => t.classList.remove('drop-target'));
    tile.classList.remove('dragging');

    if (!dragging) {
      toggleSelection(tile);
      return;
    }
    commitOrder(grid);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function toggleSelection(tile) {
  const id = tile.dataset.id;
  if (state.selected.has(id)) {
    state.selected.delete(id);
    tile.classList.remove('selected');
  } else {
    state.selected.add(id);
    tile.classList.add('selected');
  }
  renderSelectBar();
}

async function commitOrder(grid) {
  const ids = Array.from(grid.querySelectorAll('.tile')).map(t => t.dataset.id);

  // Reindex in place so the lightbox and selection keep pointing at the right photos
  const byId = new Map(state.photos.map(p => [p.id, p]));
  state.photos = ids.map(id => byId.get(id)).filter(Boolean);
  Array.from(grid.querySelectorAll('.tile')).forEach((t, i) => { t.dataset.index = i; });

  const endpoint = state.view === 'album'
    ? `/api/albums/${state.albumSlug}/order`
    : '/api/gallery/order';

  try {
    await api(endpoint, { method: 'PATCH', json: { ids } });
    toast('Order saved');
  } catch (err) {
    toast(`Could not save the order: ${err.message}`);
    render();
  }
}

function emptyState(title, body) {
  return `<div class="state"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
}

async function renderGallery() {
  el.main.innerHTML = skeletons();
  try {
    const data = await api('/api/gallery');
    state.photos = data.photos;
    if (!state.photos.length) {
      el.main.innerHTML = emptyState('Nothing here yet', 'Photos added to the gallery will show up on this page.');
      return;
    }
    const ownerBar = isOwner()
      ? `<button class="btn btn-sm btn-outline" id="galleryEditBtn" type="button">${state.editing ? 'Done' : 'Edit'}</button>`
      : `<span class="section-count">${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}</span>`;

    el.main.innerHTML = `
      <div class="section-bar">
        <h2>Gallery</h2>
        ${ownerBar}
      </div>
      ${state.editing ? selectBarHTML() : ''}
      ${state.editing ? '<p class="edit-hint">Drag a photo to reorder. Click one to select it.</p>' : ''}
      ${photoGridHTML(state.photos)}
    `;
    wireGrid();
    warmPreviews(state.photos);
    if (state.editing) {
      wireSelectBar();
      renderSelectBar();
    }

    const editBtn = document.getElementById('galleryEditBtn');
    if (editBtn) editBtn.addEventListener('click', () => {
      state.editing = !state.editing;
      state.selected.clear();
      render();
    });
  } catch (err) {
    el.main.innerHTML = emptyState('Could not load photos', err.message);
  }
}

async function renderAlbums() {
  el.main.innerHTML = skeletons();
  try {
    const data = await api('/api/albums');
    state.albums = data.albums;
    state.photos = [];

    const ownerBar = isOwner()
      ? '<button class="btn btn-sm btn-outline" id="newAlbumBtn" type="button">New album</button>'
      : '';

    if (!state.albums.length) {
      el.main.innerHTML = `
        <div class="section-bar"><h2>Albums</h2>${ownerBar}</div>
        ${emptyState('No albums yet', isOwner() ? 'Create one to start grouping photos.' : 'Check back later.')}
      `;
    } else {
      el.main.innerHTML = `
        <div class="section-bar">
          <h2>Albums</h2>
          ${ownerBar || `<span class="section-count">${state.albums.length} album${state.albums.length === 1 ? '' : 's'}</span>`}
        </div>
        <div class="album-grid">${state.albums.map(albumCardHTML).join('')}</div>
      `;
    }

    const newAlbumBtn = document.getElementById('newAlbumBtn');
    if (newAlbumBtn) newAlbumBtn.addEventListener('click', () => openAlbumModal(null));

    el.main.querySelectorAll('.album-card').forEach(card => {
      const slug = card.dataset.slug;
      const album = state.albums.find(a => a.slug === slug);
      card.addEventListener('click', e => {
        const action = e.target.closest('[data-action]');
        if (action) {
          e.stopPropagation();
          if (action.dataset.action === 'edit') openAlbumModal(album);
          if (action.dataset.action === 'delete') confirmDeleteAlbum(album);
          if (action.dataset.action === 'upload') openUploadModal(album.slug);
          return;
        }
        if (album.locked && !albumToken(album.slug)) promptAlbumPassword(album);
        else location.hash = `#album/${album.slug}`;
      });
    });
  } catch (err) {
    el.main.innerHTML = emptyState('Could not load albums', err.message);
  }
}

function albumCardHTML(album) {
  let cover;
  if (album.locked) {
    cover = `<div class="album-cover locked">
         <svg class="album-lock-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
           <rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
         </svg>
       </div>`;
  } else if (album.cover) {
    cover = `<div class="album-cover"><img src="${esc(album.cover)}" alt="" loading="lazy"></div>`;
  } else {
    cover = `<div class="album-cover empty">
         <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m3.5 17 5-5 4.5 4.5 3-2.5 4.5 4"/>
         </svg>
       </div>`;
  }

  const meta = album.locked
    ? 'Private · password required'
    : `${album.count} photo${album.count === 1 ? '' : 's'}${album.visibility === 'private' ? ' · private' : ''}`;

  const ownerRow = isOwner()
    ? `<div class="album-owner-row">
         <button data-action="upload" type="button">Add photos</button>
         <button data-action="edit" type="button">Edit</button>
         <button data-action="delete" class="danger" type="button">Delete</button>
       </div>`
    : '';

  return `
    <article class="album-card" data-slug="${esc(album.slug)}">
      ${cover}
      <div class="album-body">
        <h3>${esc(album.name)}</h3>
        <p class="album-meta">${esc(meta)}</p>
        ${ownerRow}
      </div>
    </article>
  `;
}

async function renderAlbum(slug) {
  el.main.innerHTML = skeletons();
  try {
    if (!state.albums.length) {
      const list = await api('/api/albums');
      state.albums = list.albums;
    }

    const data = await api(`/api/albums/${slug}/photos`, { albumToken: albumToken(slug) });
    state.photos = data.photos;

    const ownerBar = isOwner()
      ? `<div style="display:flex;gap:8px">
           <button class="btn btn-sm btn-outline" id="albumEditBtn" type="button">${state.editing ? 'Done' : 'Edit'}</button>
           <button class="btn btn-sm btn-outline" id="albumUploadBtn" type="button">Add photos</button>
         </div>`
      : `<span class="section-count">${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}</span>`;

    el.main.innerHTML = `
      <a class="back-button" href="#albums">← All albums</a>
      <div class="section-bar">
        <h2>${esc(data.album.name)}${data.album.visibility === 'private' ? ' <span class="section-count">· private</span>' : ''}</h2>
        ${ownerBar}
      </div>
      ${state.editing ? selectBarHTML() : ''}
      ${state.editing ? '<p class="edit-hint">Drag a photo to reorder. Click one to select it.</p>' : ''}
      ${state.photos.length
        ? photoGridHTML(state.photos)
        : emptyState('This album is empty', isOwner() ? 'Add some photos to fill it out.' : 'Nothing in here yet.')}
    `;
    wireGrid();
    warmPreviews(state.photos);
    if (state.editing) {
      wireSelectBar();
      renderSelectBar();
    }

    const uploadBtn = document.getElementById('albumUploadBtn');
    if (uploadBtn) uploadBtn.addEventListener('click', () => openUploadModal(slug));

    const editBtn = document.getElementById('albumEditBtn');
    if (editBtn) editBtn.addEventListener('click', () => {
      state.editing = !state.editing;
      state.selected.clear();
      render();
    });
  } catch (err) {
    if (err.status === 401 && err.data && err.data.locked) {
      const album = state.albums.find(a => a.slug === slug) || { slug, name: 'Private album' };
      el.main.innerHTML = `
        <a class="back-button" href="#albums">← All albums</a>
        ${emptyState('This album is locked', 'Enter the album password to view it.')}
      `;
      promptAlbumPassword(album);
      return;
    }
    el.main.innerHTML = `
      <a class="back-button" href="#albums">← All albums</a>
      ${emptyState('Could not load this album', err.message)}
    `;
  }
}

function render() {
  el.tabs.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.view === (state.view === 'album' ? 'albums' : state.view);
    tab.classList.toggle('active', active);
  });
  renderSessionPill();
  // The per-row selector only means something when photos are on screen
  el.density.hidden = state.view === 'albums';

  // Going "back" should mean back within the site until there is nowhere left
  // to go, and only then out to the portfolio.
  if (state.view === 'gallery') {
    el.backLink.href = 'https://devinbowler.com';
    el.backLink.textContent = '← devinbowler.com';
  } else {
    el.backLink.href = '#gallery';
    el.backLink.textContent = '← Gallery';
  }

  if (state.view === 'gallery') renderGallery();
  else if (state.view === 'albums') renderAlbums();
  else renderAlbum(state.albumSlug);
}

/* ------------------------------------------------------------------ *
 * Routing and controls
 * ------------------------------------------------------------------ */

function readHash() {
  const hash = location.hash.replace(/^#/, '');
  if (hash.startsWith('album/')) {
    state.view = 'album';
    state.albumSlug = hash.slice('album/'.length);
  } else if (hash === 'albums') {
    state.view = 'albums';
    state.albumSlug = null;
  } else {
    state.view = 'gallery';
    state.albumSlug = null;
  }
}

window.addEventListener('hashchange', () => {
  closeLightbox();
  state.editing = false;
  state.selected.clear();
  readHash();
  render();
});

el.tabs.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  location.hash = tab.dataset.view === 'albums' ? '#albums' : '#gallery';
});

el.density.addEventListener('click', e => {
  const button = e.target.closest('.density-btn');
  if (!button) return;
  state.cols = Number(button.dataset.cols);
  localStorage.setItem('photos.cols', String(state.cols));
  el.density.querySelectorAll('.density-btn').forEach(b => b.classList.toggle('active', b === button));
  paintGrid();
  const skeletonGrid = el.main.querySelector('.skeleton-grid');
  if (skeletonGrid) skeletonGrid.style.setProperty('--cols', state.cols);
});

el.uploadBtn.addEventListener('click', () => {
  withOwner(async () => {
    if (!state.albums.length) {
      try {
        const data = await api('/api/albums');
        state.albums = data.albums;
      } catch (err) { /* upload into the gallery still works */ }
    }
    openUploadModal(state.view === 'album' ? state.albumSlug : null);
  });
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

document.getElementById('year').textContent = new Date().getFullYear();
el.density.querySelectorAll('.density-btn').forEach(b => {
  b.classList.toggle('active', Number(b.dataset.cols) === state.cols);
});
loadOwner();
readHash();
render();
