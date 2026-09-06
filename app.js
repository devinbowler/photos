/* devinbowler.com/photos */

const API = (window.CONFIG && window.CONFIG.API_URL) || '';

const state = {
  view: 'gallery',       // gallery | albums | album
  albumSlug: null,
  cols: Number(localStorage.getItem('photos.cols')) || 4,
  owner: null,           // { token, expiresAt }
  photos: [],
  albums: [],
  lightboxIndex: -1
};

const el = {
  main: document.getElementById('main'),
  tabs: document.getElementById('tabs'),
  density: document.getElementById('density'),
  uploadBtn: document.getElementById('uploadBtn'),
  sessionPill: document.getElementById('sessionPill'),
  lightbox: document.getElementById('lightbox'),
  lbImage: document.getElementById('lbImage'),
  lbCaption: document.getElementById('lbCaption'),
  lbMeta: document.getElementById('lbMeta'),
  lbOwnerTools: document.getElementById('lbOwnerTools'),
  lbCaptionInput: document.getElementById('lbCaptionInput'),
  lbSaveCaption: document.getElementById('lbSaveCaption'),
  lbDelete: document.getElementById('lbDelete'),
  lbClose: document.getElementById('lbClose'),
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
    <p class="modal-sub">JPEG, PNG, HEIC or WebP. Up to 25 at a time.</p>

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
      <input type="checkbox" id="showInGallery" checked>
      Also show these in the public gallery
    </label>
    <p class="field-hint">Photos in a private album never appear in the gallery.</p>

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

  function setFiles(list) {
    const all = Array.from(list);
    const picked = all.filter(isImage);
    const skipped = all.filter(f => !isImage(f));

    files = picked.slice(0, 25);
    const overflow = picked.length - files.length;

    fileList.innerHTML = files
      .map(f => `<div>${esc(f.name)} <span style="color:var(--text-muted)">${(f.size / 1024 / 1024).toFixed(1)} MB</span></div>`)
      .join('');

    const notes = [];
    if (skipped.length) notes.push(`${skipped.length} file${skipped.length === 1 ? '' : 's'} skipped, not an image`);
    if (overflow) notes.push(`${overflow} over the 25 file limit`);
    if (notes.length) modalError(notes.join(' \u00b7 '));
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

  submit.addEventListener('click', () => {
    const album = document.getElementById('albumSelect').value;
    const showInGallery = document.getElementById('showInGallery').checked;
    const progress = document.getElementById('progressBar');
    const bar = progress.querySelector('span');

    const form = new FormData();
    files.forEach(f => form.append('files', f));
    if (album) form.append('album', album);
    form.append('showInGallery', String(showInGallery));

    submit.disabled = true;
    submit.textContent = 'Uploading...';
    progress.hidden = false;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', API + '/api/photos');
    xhr.setRequestHeader('Authorization', `Bearer ${state.owner.token}`);
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) bar.style.width = `${Math.round((e.loaded / e.total) * 92)}%`;
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        bar.style.width = '100%';
        const count = files.length;
        closeModal();
        toast(`Uploaded ${count} photo${count === 1 ? '' : 's'}`);
        render();
      } else {
        let message = 'Upload failed';
        try { message = JSON.parse(xhr.responseText).error || message; } catch (err) { /* ignore */ }
        submit.disabled = false;
        submit.textContent = `Upload ${files.length}`;
        progress.hidden = true;
        modalError(message);
      }
    });
    xhr.addEventListener('error', () => {
      submit.disabled = false;
      submit.textContent = `Upload ${files.length}`;
      progress.hidden = true;
      modalError('Network error, the server may be waking up. Try again.');
    });
    xhr.send(form);
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
      <div class="modal-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-close="1">Cancel</button>
        <button class="btn btn-sm btn-primary" type="submit" id="albumSubmit">${isEdit ? 'Save' : 'Create album'}</button>
      </div>
    </form>
  `);

  const visibility = document.getElementById('albumVisibility');
  const passwordField = document.getElementById('passwordField');
  const syncPasswordField = () => { passwordField.hidden = visibility.value !== 'private'; };
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
 * Lightbox
 * ------------------------------------------------------------------ */

function openLightbox(index) {
  state.lightboxIndex = index;
  const photo = state.photos[index];
  if (!photo) return;

  el.lbImage.src = photo.full;
  el.lbImage.alt = photo.caption || 'Photo';
  el.lbCaption.textContent = photo.caption || '';
  el.lbMeta.textContent = formatDate(photo.takenAt || photo.uploadedAt);

  const owner = isOwner();
  el.lbOwnerTools.hidden = !owner;
  if (owner) el.lbCaptionInput.value = photo.caption || '';

  const many = state.photos.length > 1;
  el.lbPrev.hidden = !many;
  el.lbNext.hidden = !many;

  el.lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  el.lightbox.hidden = true;
  el.lbImage.src = '';
  state.lightboxIndex = -1;
  document.body.style.overflow = '';
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
      <figure class="tile" data-index="${i}">
        <img src="${esc(p.thumb)}" alt="${esc(p.caption || '')}" loading="lazy">
        ${p.caption ? `<figcaption class="tile-caption">${esc(p.caption)}</figcaption>` : ''}
        ${isOwner() && !p.showInGallery ? '<span class="tile-flag">Hidden</span>' : ''}
      </figure>
    `).join('')
  }</div>`;
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
    tile.addEventListener('click', () => openLightbox(Number(tile.dataset.index)));
  });
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
    el.main.innerHTML = `
      <div class="section-bar">
        <h2>Gallery</h2>
        <span class="section-count">${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}</span>
      </div>
      ${photoGridHTML(state.photos)}
    `;
    wireGrid();
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
      ? `<button class="btn btn-sm btn-outline" id="albumUploadBtn" type="button">Add photos</button>`
      : `<span class="section-count">${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}</span>`;

    el.main.innerHTML = `
      <a class="back-button" href="#albums">← All albums</a>
      <div class="section-bar">
        <h2>${esc(data.album.name)}${data.album.visibility === 'private' ? ' <span class="section-count">· private</span>' : ''}</h2>
        ${ownerBar}
      </div>
      ${state.photos.length
        ? photoGridHTML(state.photos)
        : emptyState('This album is empty', isOwner() ? 'Add some photos to fill it out.' : 'Nothing in here yet.')}
    `;
    wireGrid();
    const uploadBtn = document.getElementById('albumUploadBtn');
    if (uploadBtn) uploadBtn.addEventListener('click', () => openUploadModal(slug));
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
