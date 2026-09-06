const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const OWNER_TOKEN_TTL_MS = 30 * 60 * 1000;      // 30 minutes
const ALBUM_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const TOKEN_SECRET =
  process.env.TOKEN_SECRET ||
  crypto.createHash('sha256').update(String(process.env.APP_PASSWORD || 'dev')).digest('hex');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Album-Token']
}));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: OWNER_TOKEN_TTL_MS / 1000 }
});
const Token = mongoose.model('Token', tokenSchema);

const albumSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  passwordHash: { type: String, default: null },
  passwordSalt: { type: String, default: null },
  coverPublicId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Album = mongoose.model('Album', albumSchema);

const photoSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  width: Number,
  height: Number,
  format: String,
  bytes: Number,
  caption: { type: String, default: '' },
  album: { type: String, default: null, index: true }, // album slug, null = loose in gallery
  showInGallery: { type: Boolean, default: true },
  takenAt: { type: Date, default: null },
  uploadedAt: { type: Date, default: Date.now }
});
const Photo = mongoose.model('Photo', photoSchema);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'album';
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return { hash, salt: useSalt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// Constant-time compare for the main app password
function matchesAppPassword(password) {
  const correct = process.env.APP_PASSWORD;
  if (!correct) return false;
  const a = crypto.createHash('sha256').update(String(password)).digest();
  const b = crypto.createHash('sha256').update(String(correct)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Stateless signed token for album access: slug.expiry.signature
function signAlbumToken(slug) {
  const exp = Date.now() + ALBUM_TOKEN_TTL_MS;
  const payload = `${slug}.${exp}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function albumTokenGrants(token, slug) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tokenSlug, expRaw, sig] = parts;
  if (tokenSlug !== slug) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${tokenSlug}.${expRaw}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Build a Cloudinary derived URL by injecting a transformation after /upload/
function derive(url, transform) {
  if (!url) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

function serializePhoto(photo) {
  return {
    id: photo._id,
    publicId: photo.publicId,
    caption: photo.caption || '',
    album: photo.album || null,
    showInGallery: photo.showInGallery,
    width: photo.width,
    height: photo.height,
    takenAt: photo.takenAt,
    uploadedAt: photo.uploadedAt,
    thumb: derive(photo.url, 'c_fill,g_auto,w_700,h_700,q_auto,f_auto'),
    full: derive(photo.url, 'c_limit,w_2000,h_2000,q_auto,f_auto'),
    original: photo.url
  };
}

function sortKey(photo) {
  return photo.takenAt || photo.uploadedAt;
}

async function requireOwner(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  const token = header.slice(7);
  try {
    const found = await Token.findOne({ token });
    if (!found) return res.status(401).json({ error: 'Session expired' });
    if (Date.now() - found.createdAt.getTime() > OWNER_TOKEN_TTL_MS) {
      await Token.deleteOne({ token });
      return res.status(401).json({ error: 'Session expired' });
    }
    req.ownerExpiresAt = found.createdAt.getTime() + OWNER_TOKEN_TTL_MS;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session check failed' });
  }
}

// Non-blocking version: sets req.isOwner but never rejects
async function detectOwner(req, res, next) {
  req.isOwner = false;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const found = await Token.findOne({ token: header.slice(7) });
      if (found && Date.now() - found.createdAt.getTime() <= OWNER_TOKEN_TTL_MS) {
        req.isOwner = true;
      }
    } catch (err) { /* treated as public visitor */ }
  }
  next();
}

// Simple in-memory throttle so the password fields can't be brute forced
const attempts = new Map();
function throttle(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const record = attempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 15 * 60 * 1000;
  }
  if (record.count >= 10) {
    const mins = Math.ceil((record.resetAt - now) / 60000);
    return res.status(429).json({ error: `Too many attempts, try again in ${mins} min` });
  }
  record.count += 1;
  attempts.set(key, record);
  req.throttleRecord = record;
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Some browsers send an empty or generic type for .heic, so allow a known
    // image extension through rather than rejecting the upload outright.
    const byMime = /^image\//.test(file.mimetype || '');
    const generic = !file.mimetype || file.mimetype === 'application/octet-stream';
    const byName = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i.test(file.originalname || '');
    if (byMime || (generic && byName)) cb(null, true);
    else cb(new Error(`${file.originalname} is not an image file`), false);
  },
  limits: { fileSize: 25 * 1024 * 1024, files: 25 }
});

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', image_metadata: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

function parseExifDate(value) {
  if (!value) return null;
  // EXIF format: "2026:07:14 18:22:05"
  const m = String(value).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Photos API is running' });
});

app.post('/api/auth', throttle, async (req, res) => {
  if (!process.env.APP_PASSWORD) {
    return res.status(500).json({ error: 'Server is missing APP_PASSWORD' });
  }
  if (!matchesAppPassword(req.body.password || '')) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (req.throttleRecord) req.throttleRecord.count = 0;
  try {
    const token = crypto.randomBytes(32).toString('hex');
    await Token.create({ token });
    res.json({ token, expiresAt: Date.now() + OWNER_TOKEN_TTL_MS });
  } catch (err) {
    res.status(500).json({ error: 'Could not start session' });
  }
});

app.get('/api/session', requireOwner, (req, res) => {
  res.json({ ok: true, expiresAt: req.ownerExpiresAt });
});

app.post('/api/auth/logout', async (req, res) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try { await Token.deleteOne({ token: header.slice(7) }); } catch (err) { /* ignore */ }
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Gallery
 * ------------------------------------------------------------------ */

app.get('/api/gallery', detectOwner, async (req, res) => {
  try {
    const privateAlbums = await Album.find({ visibility: 'private' }).select('slug');
    const blocked = privateAlbums.map(a => a.slug);
    const photos = await Photo.find({
      showInGallery: true,
      album: { $nin: blocked }
    });
    photos.sort((a, b) => sortKey(b) - sortKey(a));
    res.json({ photos: photos.map(serializePhoto) });
  } catch (err) {
    console.error('Gallery error:', err);
    res.status(500).json({ error: 'Could not load the gallery' });
  }
});

/* ------------------------------------------------------------------ *
 * Albums
 * ------------------------------------------------------------------ */

app.get('/api/albums', detectOwner, async (req, res) => {
  try {
    const albums = await Album.find().sort({ createdAt: -1 });
    const out = [];
    for (const album of albums) {
      const count = await Photo.countDocuments({ album: album.slug });
      const locked = album.visibility === 'private' && !req.isOwner;
      let cover = null;
      if (!locked) {
        const coverPhoto = album.coverPublicId
          ? await Photo.findOne({ publicId: album.coverPublicId })
          : await Photo.findOne({ album: album.slug }).sort({ uploadedAt: -1 });
        if (coverPhoto) cover = derive(coverPhoto.url, 'c_fill,g_auto,w_800,h_600,q_auto,f_auto');
      }
      out.push({
        name: album.name,
        slug: album.slug,
        visibility: album.visibility,
        locked,
        count,
        cover,
        createdAt: album.createdAt
      });
    }
    res.json({ albums: out });
  } catch (err) {
    console.error('Albums error:', err);
    res.status(500).json({ error: 'Could not load albums' });
  }
});

app.post('/api/albums', requireOwner, async (req, res) => {
  try {
    const { name, visibility = 'public', password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Album needs a name' });
    if (visibility === 'private' && !password) {
      return res.status(400).json({ error: 'Private albums need a password' });
    }

    let slug = slugify(name);
    let suffix = 2;
    while (await Album.findOne({ slug })) slug = `${slugify(name)}-${suffix++}`;

    const doc = { name: name.trim(), slug, visibility };
    if (visibility === 'private') {
      const { hash, salt } = hashPassword(password);
      doc.passwordHash = hash;
      doc.passwordSalt = salt;
    }
    const album = await Album.create(doc);
    res.status(201).json({ album: { name: album.name, slug: album.slug, visibility: album.visibility, count: 0, cover: null, locked: false } });
  } catch (err) {
    console.error('Create album error:', err);
    res.status(500).json({ error: 'Could not create the album' });
  }
});

app.patch('/api/albums/:slug', requireOwner, async (req, res) => {
  try {
    const album = await Album.findOne({ slug: req.params.slug });
    if (!album) return res.status(404).json({ error: 'Album not found' });

    const { name, visibility, password, coverPublicId } = req.body;
    if (typeof name === 'string' && name.trim()) album.name = name.trim();
    if (typeof coverPublicId === 'string') album.coverPublicId = coverPublicId;

    if (visibility === 'public') {
      album.visibility = 'public';
      album.passwordHash = null;
      album.passwordSalt = null;
    } else if (visibility === 'private') {
      if (!password && !album.passwordHash) {
        return res.status(400).json({ error: 'Private albums need a password' });
      }
      album.visibility = 'private';
      // Private album photos should not leak into the public gallery
      await Photo.updateMany({ album: album.slug }, { showInGallery: false });
    }
    if (password) {
      const { hash, salt } = hashPassword(password);
      album.passwordHash = hash;
      album.passwordSalt = salt;
    }

    await album.save();
    res.json({ album: { name: album.name, slug: album.slug, visibility: album.visibility } });
  } catch (err) {
    console.error('Update album error:', err);
    res.status(500).json({ error: 'Could not update the album' });
  }
});

app.delete('/api/albums/:slug', requireOwner, async (req, res) => {
  try {
    const album = await Album.findOne({ slug: req.params.slug });
    if (!album) return res.status(404).json({ error: 'Album not found' });

    const keepPhotos = req.query.keepPhotos === 'true';
    if (keepPhotos) {
      await Photo.updateMany({ album: album.slug }, { album: null });
    } else {
      const photos = await Photo.find({ album: album.slug });
      for (const photo of photos) {
        try { await cloudinary.uploader.destroy(photo.publicId); } catch (err) { /* keep going */ }
      }
      await Photo.deleteMany({ album: album.slug });
    }
    await Album.deleteOne({ slug: album.slug });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete album error:', err);
    res.status(500).json({ error: 'Could not delete the album' });
  }
});

app.post('/api/albums/:slug/unlock', throttle, async (req, res) => {
  try {
    const album = await Album.findOne({ slug: req.params.slug });
    if (!album) return res.status(404).json({ error: 'Album not found' });
    if (album.visibility !== 'private') return res.json({ token: null, open: true });

    if (!verifyPassword(req.body.password || '', album.passwordHash, album.passwordSalt)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (req.throttleRecord) req.throttleRecord.count = 0;
    res.json({ token: signAlbumToken(album.slug), expiresAt: Date.now() + ALBUM_TOKEN_TTL_MS });
  } catch (err) {
    console.error('Unlock error:', err);
    res.status(500).json({ error: 'Could not unlock the album' });
  }
});

app.get('/api/albums/:slug/photos', detectOwner, async (req, res) => {
  try {
    const album = await Album.findOne({ slug: req.params.slug });
    if (!album) return res.status(404).json({ error: 'Album not found' });

    if (album.visibility === 'private' && !req.isOwner) {
      const token = req.headers['x-album-token'];
      if (!albumTokenGrants(token, album.slug)) {
        return res.status(401).json({ error: 'This album is locked', locked: true });
      }
    }

    const photos = await Photo.find({ album: album.slug });
    photos.sort((a, b) => sortKey(b) - sortKey(a));
    res.json({
      album: { name: album.name, slug: album.slug, visibility: album.visibility },
      photos: photos.map(serializePhoto)
    });
  } catch (err) {
    console.error('Album photos error:', err);
    res.status(500).json({ error: 'Could not load the album' });
  }
});

/* ------------------------------------------------------------------ *
 * Photos
 * ------------------------------------------------------------------ */

app.post('/api/photos', requireOwner, upload.array('files', 25), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images were sent' });
    }

    const albumSlug = req.body.album && req.body.album !== 'null' ? req.body.album : null;
    let album = null;
    if (albumSlug) {
      album = await Album.findOne({ slug: albumSlug });
      if (!album) return res.status(400).json({ error: 'That album does not exist' });
    }

    const folder = albumSlug ? `photos/${albumSlug}` : 'photos/gallery';
    const showInGallery = album && album.visibility === 'private'
      ? false
      : req.body.showInGallery !== 'false';

    const saved = [];
    for (const file of req.files) {
      const result = await uploadToCloudinary(file.buffer, folder);
      const meta = result.image_metadata || {};
      const photo = await Photo.create({
        publicId: result.public_id,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
        caption: '',
        album: albumSlug,
        showInGallery,
        takenAt: parseExifDate(meta.DateTimeOriginal || meta.DateTime || meta.CreateDate)
      });
      saved.push(serializePhoto(photo));
    }

    res.status(201).json({ photos: saved });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.patch('/api/photos/:id', requireOwner, async (req, res) => {
  try {
    const photo = await Photo.findById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    if (typeof req.body.caption === 'string') photo.caption = req.body.caption.slice(0, 500);
    if (typeof req.body.showInGallery === 'boolean') photo.showInGallery = req.body.showInGallery;
    if ('album' in req.body) {
      const target = req.body.album || null;
      if (target) {
        const album = await Album.findOne({ slug: target });
        if (!album) return res.status(400).json({ error: 'That album does not exist' });
        if (album.visibility === 'private') photo.showInGallery = false;
      }
      photo.album = target;
    }

    await photo.save();
    res.json({ photo: serializePhoto(photo) });
  } catch (err) {
    console.error('Update photo error:', err);
    res.status(500).json({ error: 'Could not update the photo' });
  }
});

app.delete('/api/photos/:id', requireOwner, async (req, res) => {
  try {
    const photo = await Photo.findById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    try { await cloudinary.uploader.destroy(photo.publicId); } catch (err) { /* orphan cleanup is fine */ }
    await Photo.deleteOne({ _id: photo._id });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Could not delete the photo' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'One of those images is over 25MB' : err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Photos API running on port ${PORT}`);
  });
}

// Exported so the helpers can be unit tested without a database
module.exports = {
  app,
  slugify,
  hashPassword,
  verifyPassword,
  signAlbumToken,
  albumTokenGrants,
  derive,
  parseExifDate,
  matchesAppPassword
};
