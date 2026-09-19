const express = require('express');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const { deleteCloudinaryAsset } = require('../utils/cloudinary');
const CompanyInfo = require('../models/CompanyInfo');
const protectAdmin = require('../middleware/auth');

const router = express.Router();

// Only these exact fields are ever accepted from the admin form. Spreading
// req.body directly into a DB update would let unexpected or malformed keys
// (or fields the schema doesn't expect) reach the database - whitelisting
// keeps the update predictable regardless of what the client sends.
const ALLOWED_COMPANY_FIELDS = [
  'companyName', 'tagline', 'aboutUs', 'email', 'phone', 'address',
  'facebook', 'instagram', 'whatsapp', 'tiktok', 'snapchat',
];

function pickCompanyFields(body) {
  const result = {};
  for (const key of ALLOWED_COMPANY_FIELDS) {
    if (typeof body[key] === 'string') result[key] = body[key];
  }
  return result;
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'marketing-app/company',
    resource_type: 'image',
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

// GET /api/company -> anyone (customers) can view company info
router.get('/', async (req, res) => {
  try {
    let info = await CompanyInfo.findOne();
    if (!info) {
      info = await CompanyInfo.create({}); // create default doc the first time
    }
    res.json(info);
  } catch (err) {
    console.error('Failed to load company info.', err);
    res.status(500).json({ message: 'Failed to load company info.' });
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
    const updateData = pickCompanyFields(req.body);
    if (req.file) updateData.logoUrl = req.file.path;

    let info = await CompanyInfo.findOne();
    if (!info) {
      info = await CompanyInfo.create(updateData);
    } else {
      info = await CompanyInfo.findOneAndUpdate({}, updateData, { new: true, runValidators: true });
    }
    if (req.file && previousInfo?.logoUrl) await deleteCloudinaryAsset(previousInfo.logoUrl);
    res.json(info);
  } catch (err) {
    if (req.file) await deleteCloudinaryAsset(req.file);
    console.error('Failed to update company info.', err);
    res.status(500).json({ message: 'Failed to update company info.' });
  }
});

module.exports = router;
