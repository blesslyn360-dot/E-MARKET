const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const CompanyInfo = require('../models/CompanyInfo');
const protectAdmin = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${extension}`;
    cb(null, uniqueName);
  },
});
const uploadLogo = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed for the company logo.'));
  },
});

function removeLogoFile(logoUrl) {
  if (!logoUrl || !logoUrl.startsWith('/uploads/')) return;
  try {
    fs.unlinkSync(path.join(__dirname, '..', 'uploads', path.basename(logoUrl)));
  } catch (err) {
    // A missing old logo should not prevent the company update.
  }
}

// GET /api/company -> anyone (customers) can view company info
router.get('/', async (req, res) => {
  try {
    let info = await CompanyInfo.findOne();
    if (!info) {
      info = await CompanyInfo.create({}); // create default doc the first time
    }
    res.json(info);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load company info.', error: err.message });
  }
});

// PUT /api/company -> ADMIN ONLY: update company info via the admin form
router.put('/', protectAdmin, (req, res, next) => {
  uploadLogo.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'The company logo must be 10MB or smaller.' });
    }
    return res.status(400).json({ message: err.message || 'Invalid company logo upload.' });
  });
}, async (req, res) => {
  try {
    const previousInfo = await CompanyInfo.findOne();
    const updateData = { ...req.body };
    if (req.file) updateData.logoUrl = `/uploads/${req.file.filename}`;

    let info = await CompanyInfo.findOne();
    if (!info) {
      info = await CompanyInfo.create(updateData);
    } else {
      info = await CompanyInfo.findOneAndUpdate({}, updateData, { new: true, runValidators: true });
    }
    if (req.file && previousInfo?.logoUrl) removeLogoFile(previousInfo.logoUrl);
    res.json(info);
  } catch (err) {
    if (req.file) removeLogoFile(`/uploads/${req.file.filename}`);
    res.status(500).json({ message: 'Failed to update company info.', error: err.message });
  }
});

module.exports = router;
