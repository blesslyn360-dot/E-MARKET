const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  });
});

module.exports = router;
