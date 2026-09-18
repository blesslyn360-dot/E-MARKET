const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, default: 0 },
    images: [
      {
        url: { type: String, required: true },
        caption: { type: String, default: '' },
      },
    ],
    videos: [
      {
        url: { type: String, required: true },
        caption: { type: String, default: '' },
      },
    ],
    // Retained so products created before the gallery migration remain visible.
    imageUrl: { type: String, default: '' },
    category: { type: String, default: 'General' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
