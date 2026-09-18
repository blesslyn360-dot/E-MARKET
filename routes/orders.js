const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const protectAdmin = require('../middleware/auth');
const { verifyPaystackTransaction } = require('../utils/paystack');

const router = express.Router();

function resolveSelectedImage(product, selectedImage) {
  const productImages = product.images?.length
    ? product.images
    : (product.imageUrl ? [{ url: product.imageUrl, caption: '' }] : []);
  const requestedUrl = selectedImage?.url;
  const matchingImage = productImages.find((image) => image.url === requestedUrl);
  if (matchingImage) {
    return { url: matchingImage.url, caption: matchingImage.caption || '' };
  }
  return {
    url: productImages[0]?.url || '',
    caption: productImages[0]?.caption || '',
  };
}

// POST /api/orders -> a customer submits a purchase (no login needed to buy)
router.post('/', async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, deliveryAddress, items, paystackReference } = req.body;

    if (!paystackReference) {
      return res.status(400).json({ message: 'A Paystack payment reference is required.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Your cart is empty.' });
    }
    if (typeof customerEmail !== 'string' || !customerEmail.trim()) {
      return res.status(400).json({ message: 'A valid customer email is required.' });
    }

    // Recalculate total on the server from real product prices (never trust client-sent totals)
    let totalAmount = 0;
    const orderItems = [];
    const requestedQuantities = new Map();

    for (const item of items) {
      if (!item?.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        return res.status(400).json({ message: 'Each order item must have a valid product and quantity.' });
      }
      const product = await Product.findById(item.productId);
      if (!product) return res.status(400).json({ message: 'One or more products are no longer available.' });
      const requestedQuantity = (requestedQuantities.get(String(product._id)) || 0) + item.quantity;
      requestedQuantities.set(String(product._id), requestedQuantity);
      if (requestedQuantity > product.quantity) {
        return res.status(409).json({ message: `${product.name} does not have enough stock available.` });
      }
      const lineTotal = product.price * item.quantity;
      totalAmount += lineTotal;
      orderItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        selectedImage: resolveSelectedImage(product, item.selectedImage),
      });
    }

    const payment = await verifyPaystackTransaction(paystackReference);
    if (!payment.success) {
      console.error('Paystack verification failed:', payment.message);
      return res.status(400).json({ message: payment.message });
    }

    if (payment.currency && payment.currency.toUpperCase() !== 'GHS') {
      return res.status(400).json({ message: 'The payment currency is invalid.' });
    }
    if (payment.email && payment.email.toLowerCase() !== customerEmail.trim().toLowerCase()) {
      return res.status(400).json({ message: 'The payment email does not match the order email.' });
    }

    if (Math.round(payment.amount) !== Math.round(totalAmount * 100)) {
      console.error('Payment amount mismatch:', {
        paidMinorUnits: payment.amount,
        expectedMinorUnits: Math.round(totalAmount * 100),
      });
      return res.status(400).json({ message: 'The payment amount does not match the order total.' });
    }

    const session = await mongoose.startSession();
    let order;
    try {
      await session.withTransaction(async () => {
        for (const [productId, requestedQuantity] of requestedQuantities) {
          const updatedProduct = await Product.findOneAndUpdate(
            { _id: productId, quantity: { $gte: requestedQuantity } },
            { $inc: { quantity: -requestedQuantity } },
            { new: true, session }
          );
          if (!updatedProduct) {
            const stockError = new Error('One or more products no longer have enough stock available.');
            stockError.code = 'INSUFFICIENT_STOCK';
            throw stockError;
          }
        }

        [order] = await Order.create([{
          customerName,
          customerEmail,
          customerPhone,
          deliveryAddress,
          items: orderItems,
          totalAmount,
          paymentReference: paystackReference,
          paymentStatus: 'Paid',
        }], { session });
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_STOCK') {
        return res.status(409).json({ message: err.message });
      }
      throw err;
    } finally {
      await session.endSession();
    }

    res.status(201).json({ message: 'Order placed successfully!', order });
  } catch (err) {
    console.error('Failed to create order:', err);
    res.status(500).json({ message: 'Failed to place order.', error: err.message });
  }
});

// GET /api/orders -> ADMIN ONLY: see every order with full details
router.get('/', protectAdmin, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load orders.', error: err.message });
  }
});

// GET /api/orders/:id/status -> public status lookup for saved receipts
router.get('/:id/status', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).select('status');
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    res.json({ status: order.status });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ message: 'Order not found.' });
    }
    res.status(500).json({ message: 'Failed to load order status.' });
  }
});

// DELETE /api/orders/:id -> ADMIN ONLY: remove an order
router.delete('/:id', protectAdmin, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    res.json({ message: 'Order deleted.' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ message: 'Order not found.' });
    }
    res.status(500).json({ message: 'Failed to delete order.', error: err.message });
  }
});

// PUT /api/orders/:id -> ADMIN ONLY: update order status (e.g. mark Completed)
router.put('/:id', protectAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update order.', error: err.message });
  }
});

module.exports = router;
