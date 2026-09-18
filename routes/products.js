const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Product = require('../models/Product');
const protectAdmin = require('../middleware/auth');

const router = express.Router();
const MAX_PRODUCT_IMAGES = 20;

// --- Product media upload setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${extension}`;
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype);
    if (isImage || isVideo) return cb(null, true);
    return cb(new Error('Only image files and MP4, WebM, or QuickTime videos are allowed.'));
  },
});

const uploadProductMedia = (req, res, next) => {
  upload.fields([
    { name: 'images', maxCount: MAX_PRODUCT_IMAGES },
    { name: 'videos', maxCount: 2 },
  ])(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Each image or video must be 50MB or smaller.' });
    }
    return res.status(400).json({ message: err.message || 'Invalid product media upload.' });
  });
};

function parseCaptions(value) {
  if (!value) return [];
  try {
    const captions = JSON.parse(value);
    return Array.isArray(captions) ? captions : [];
  } catch (err) {
    return [];
  }
}

function buildImages(files, captions) {
  return (files || []).map((file, index) => ({
    url: `/uploads/${file.filename}`,
    caption: captions[index] || '',
  }));
}

function buildVideos(files, captions) {
  return (files || []).map((file, index) => ({
    url: `/uploads/${file.filename}`,
    caption: captions[index] || '',
  }));
}

function parseMediaList(value) {
  if (value === undefined) return null;
  try {
    const media = JSON.parse(value);
    return Array.isArray(media) ? media : [];
  } catch (err) {
    return [];
  }
}

function reconcileMedia(keptUrls, keptCaptions, files, newCaptions) {
  const kept = keptUrls.map((url, index) => ({
    url,
    caption: keptCaptions[index] || '',
  }));
  return kept.concat(buildImages(files, newCaptions));
}

function filterExistingMedia(urls, existingMedia) {
  const existingUrls = new Set(existingMedia.map((media) => media.url));
  return urls.filter((url) => existingUrls.has(url));
}

function removeUploadedFiles(files) {
  (files || []).forEach((file) => removeUploadedFile(`/uploads/${file.filename}`));
}

function removeUploadedFile(mediaUrl) {
  if (!mediaUrl || !mediaUrl.startsWith('/uploads/')) return;
  const filePath = path.join(__dirname, '..', 'uploads', path.basename(mediaUrl));
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    // A missing file should not prevent the product update from succeeding.
  }
}

function removeDeletedMedia(previousMedia, nextMedia) {
  const keptUrls = new Set(nextMedia.map((media) => media.url));
  previousMedia.forEach((media) => {
    if (!keptUrls.has(media.url)) removeUploadedFile(media.url);
  });
}

// GET /api/products -> anyone (customers) can view all products
router.get('/', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load products.', error: err.message });
  }
});

// POST /api/products -> ADMIN ONLY: add a new product/good
router.post('/', protectAdmin, uploadProductMedia, async (req, res) => {
  try {
    const { name, description, price, quantity, category } = req.body;
    const images = buildImages(req.files?.images, parseCaptions(req.body.captions));
    const videos = buildVideos(req.files?.videos, parseCaptions(req.body.videoCaptions));

    const product = await Product.create({
      name,
      description,
      price,
      quantity,
      category,
      images,
      videos,
      imageUrl: images[0]?.url || '',
    });

    res.status(201).json(product);
  } catch (err) {
    removeUploadedFiles(req.files?.images);
    removeUploadedFiles(req.files?.videos);
    res.status(500).json({ message: 'Failed to add product.', error: err.message });
  }
});

// PUT /api/products/:id -> ADMIN ONLY: edit a product
router.put('/:id', protectAdmin, uploadProductMedia, async (req, res) => {
  try {
    const { name, description, price, quantity, category } = req.body;
    const existingProduct = await Product.findById(req.params.id);
    if (!existingProduct) return res.status(404).json({ message: 'Product not found.' });

    const updateData = { name, description, price, quantity, category };
    const keptImages = parseMediaList(req.body.keepImages);
    const keptVideos = parseMediaList(req.body.keepVideos);

    if (keptImages !== null) {
      const validKeptImages = filterExistingMedia(keptImages, existingProduct.images || []);
      if (validKeptImages.length + (req.files?.images?.length || 0) > MAX_PRODUCT_IMAGES) {
        removeUploadedFiles(req.files?.images);
        removeUploadedFiles(req.files?.videos);
        return res.status(400).json({ message: `A product can have a maximum of ${MAX_PRODUCT_IMAGES} images.` });
      }
      updateData.images = reconcileMedia(
        validKeptImages,
        parseCaptions(req.body.keepImageCaptions),
        req.files?.images,
        parseCaptions(req.body.newImageCaptions)
      );
      updateData.imageUrl = updateData.images[0]?.url || '';
    } else if (req.files?.images?.length) {
      updateData.images = buildImages(req.files.images, parseCaptions(req.body.captions));
      updateData.imageUrl = updateData.images[0]?.url || '';
    }

    if (keptVideos !== null) {
      const validKeptVideos = filterExistingMedia(keptVideos, existingProduct.videos || []);
      if (validKeptVideos.length + (req.files?.videos?.length || 0) > 2) {
        removeUploadedFiles(req.files?.images);
        removeUploadedFiles(req.files?.videos);
        return res.status(400).json({ message: 'A product can have a maximum of 2 videos.' });
      }
      updateData.videos = reconcileMedia(
        validKeptVideos,
        parseCaptions(req.body.keepVideoCaptions),
        req.files?.videos,
        parseCaptions(req.body.newVideoCaptions)
      );
    } else if (req.files?.videos?.length) {
      updateData.videos = buildVideos(req.files.videos, parseCaptions(req.body.videoCaptions));
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    if (keptImages !== null) removeDeletedMedia(existingProduct.images || [], product.images || []);
    if (keptVideos !== null) removeDeletedMedia(existingProduct.videos || [], product.videos || []);
    res.json(product);
  } catch (err) {
    removeUploadedFiles(req.files?.images);
    removeUploadedFiles(req.files?.videos);
    res.status(500).json({ message: 'Failed to update product.', error: err.message });
  }
});

// DELETE /api/products/:id -> ADMIN ONLY: remove a product
router.delete('/:id', protectAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    removeDeletedMedia(product.images || [], []);
    removeDeletedMedia(product.videos || [], []);
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete product.', error: err.message });
  }
});

module.exports = router;
