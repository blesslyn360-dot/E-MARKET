const mongoose = require('mongoose');

// We only ever keep ONE document in this collection - it represents
// "the" company info shown on the customer-facing site.
const companyInfoSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: 'My Company' },
    logoUrl: { type: String, default: '' },
    tagline: { type: String, default: '' },
    aboutUs: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    tiktok: { type: String, default: '' },
    snapchat: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanyInfo', companyInfoSchema);
