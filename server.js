require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const companyRoutes = require('./routes/company');
const configRoutes = require('./routes/config');

const app = express();
 app.set('trust proxy',1);
const isProduction = process.env.NODE_ENV === 'production';

// Connect to MongoDB
connectDB();

// Security middleware
// Helmet sets a range of protective HTTP headers (XSS, clickjacking, sniffing, etc.)
// with sensible defaults; CSP is left at defaults here since this app serves its
// own inline scripts - tighten further if you later remove inline JS.
app.use(helmet({ contentSecurityPolicy: false }));

// Restrict cross-origin requests. Set ALLOWED_ORIGIN in .env to your real domain
// once deployed (e.g. https://yourapp.onrender.com). Falls back to allowing
// same-origin/no-origin requests (like curl, server-to-server) if unset.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));

app.use(express.json());

// Strip any keys starting with "$" or containing "." from req.body/query/params
// so user input can never be interpreted as a MongoDB operator (NoSQL injection).
app.use(mongoSanitize());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/config', configRoutes);

// Serve the frontend (public folder)
app.use(express.static(path.join(__dirname, 'public')));

// Customer site is index.html, admin panel is admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all error handler: never leak internal error details (stack traces,
// file paths, DB error text) to the client. Full details still go to the
// server log for debugging.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    message: isProduction ? 'Something went wrong. Please try again.' : err.message,
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
