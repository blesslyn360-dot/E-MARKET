// Bump the main.js query version in index.html whenever this file changes.
const API = '/api';
let cart = [];
const productGallery = {};
const selectedImages = {};
let pendingCartItem = null;
const THEME_KEY = 'theme';
const PRODUCT_DESCRIPTION_LIMIT = 72;
let cardVideoObserver = null;
let theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

loadCompanyInfo();

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-message"></span><button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>`;
  toast.querySelector('.toast-message').textContent = message;

  const removeToast = () => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.querySelector('.toast-close').addEventListener('click', removeToast);
  container.appendChild(toast);
  setTimeout(removeToast, 4000);
}

function applyTheme() {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-mode', isDark);
  document.documentElement.classList.toggle('dark-mode', isDark);
  const toggle = document.getElementById('themeToggle');
  toggle.textContent = isDark ? 'Light mode' : 'Dark mode';
  toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

document.getElementById('themeToggle').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme();
});
applyTheme();

document.getElementById('year').textContent = new Date().getFullYear();

async function loadCompanyInfo() {
  const res = await fetch(`${API}/company`);
  const info = await res.json();

  document.getElementById('companyName').textContent = info.companyName || 'My Company';
  const logo = document.getElementById('companyLogo');
  logo.src = info.logoUrl || '';
  logo.classList.toggle('hidden', !info.logoUrl);
  document.getElementById('companyNameFooter').textContent = info.companyName || 'My Company';
  document.getElementById('tagline').textContent = info.tagline || '';
  document.getElementById('aboutUs').textContent = info.aboutUs || 'Welcome to our store!';
  document.title = info.companyName || 'Store';

  const contactList = document.getElementById('contactList');
  contactList.innerHTML = '';
  if (info.email) contactList.innerHTML += `<li>Email: ${info.email}</li>`;
  if (info.phone) contactList.innerHTML += `<li>Phone: ${info.phone}</li>`;
  if (info.address) contactList.innerHTML += `<li>Address: ${info.address}</li>`;
  if (info.whatsapp) contactList.innerHTML += `<li>WhatsApp: ${info.whatsapp}</li>`;
  [
    ['Facebook', info.facebook],
    ['Instagram', info.instagram],
    ['TikTok', info.tiktok],
    ['Snapchat', info.snapchat],
  ].forEach(([label, url]) => {
    if (!url?.trim()) return;
    const linkUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    try {
      const parsedUrl = new URL(linkUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) return;
    } catch (err) {
      return;
    }
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = linkUrl;
    link.textContent = `${label}: ${url.trim()}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.appendChild(link);
    contactList.appendChild(item);
  });
}

async function loadProducts() {
  const res = await fetch(`${API}/products`);
  const products = await res.json();
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';

  products.forEach((p) => {
    const images = (p.images?.length
      ? p.images
      : (p.imageUrl ? [{ url: p.imageUrl, caption: '' }] : []))
      .map((image) => ({ type: 'image', url: image.url, caption: image.caption || '' }));
    const videos = (p.videos || [])
      .filter((video) => video.url)
      .map((video) => ({ type: 'video', url: video.url, caption: video.caption || '' }));
    const fallbackImage = { type: 'image', url: 'https://via.placeholder.com/220x150?text=No+Image', caption: '' };
    const gallery = images.length || videos.length ? [...images, ...videos] : [fallbackImage];
    productGallery[p._id] = gallery;
    const firstImage = images[0] || fallbackImage;
    const availableQuantity = Math.max(0, Number(p.quantity) || 0);
    const isOutOfStock = availableQuantity === 0;
    const hasVideo = videos.length > 0;
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-image-wrap">
        ${hasVideo ? `
          <video class="product-card-video" autoplay muted loop playsinline preload="metadata" poster="${escapeHtml(firstImage.url)}" data-video-url="${escapeHtml(videos[0].url)}" aria-label="${escapeHtml(p.name)} product video">
            <source src="${escapeHtml(videos[0].url)}" type="${getVideoMimeType(videos[0].url)}" />
          </video>
          <button type="button" class="video-mute-toggle" onclick="toggleCardVideoSound(this)" aria-label="Unmute product video">Unmute</button>
        ` : `<img src="${escapeHtml(firstImage.url)}" alt="${escapeHtml(p.name)}" />`}
      </div>
      <h3>${escapeHtml(p.name)}</h3>
      <span class="product-category">${escapeHtml(p.category || 'General')}</span>
      <div class="product-description">
        <span class="description-text"></span>
        <button type="button" class="description-toggle hidden" onclick="toggleProductDescription(this)"></button>
      </div>
      <p class="stock-count${isOutOfStock ? ' out-of-stock' : ''}">${isOutOfStock ? 'Out Of Stock' : `${availableQuantity} in stock`}</p>
      <p class="price">₵${p.price.toFixed(2)}</p>
      ${gallery.length > 1 || hasVideo ? `<button type="button" class="gallery-link" onclick="openGallery('${escapeHtml(p._id)}')">View more photos</button>` : ''}
      <button class="add-to-cart-btn" data-product-id="${escapeHtml(p._id)}" data-product-name="${escapeHtml(p.name)}" data-product-price="${p.price}" data-product-quantity="${availableQuantity}" ${isOutOfStock ? 'disabled' : ''}>
        ${isOutOfStock ? 'Out Of Stock' : 'Add to Cart'}
      </button>
    `;

    card.querySelector('.add-to-cart-btn').addEventListener('click', (event) => {
      const button = event.currentTarget;
      addToCart(button.dataset.productId, button.dataset.productName, Number(button.dataset.productPrice), Number(button.dataset.productQuantity));
    });

    const description = p.description || '';
    const descriptionText = card.querySelector('.description-text');
    const descriptionToggle = card.querySelector('.description-toggle');
    const isLongDescription = description.length > PRODUCT_DESCRIPTION_LIMIT;
    descriptionText.textContent = isLongDescription
      ? `${description.slice(0, PRODUCT_DESCRIPTION_LIMIT).trimEnd()}...`
      : description;
    if (isLongDescription) {
      descriptionToggle.textContent = 'Read more';
      descriptionToggle.dataset.fullDescription = description;
      descriptionToggle.dataset.expanded = 'false';
      descriptionToggle.classList.remove('hidden');
    }
    grid.appendChild(card);
  });
  observeCardVideos();
}

function getVideoMimeType(url) {
  const normalizedUrl = url.toLowerCase().split('?')[0];
  if (normalizedUrl.endsWith('.webm')) return 'video/webm';
  if (normalizedUrl.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

function observeCardVideos() {
  if (cardVideoObserver) cardVideoObserver.disconnect();

  const videos = document.querySelectorAll('.product-card-video');
  if (!videos.length) return;

  videos.forEach((video) => {
    video.muted = true;
  });

  const playVideo = (video) => {
    video.play().catch((error) => {
      console.warn('[product media] Could not autoplay video:', video.dataset.videoUrl, error);
    });
  };

  if (!('IntersectionObserver' in window)) {
    videos.forEach(playVideo);
    return;
  }

  cardVideoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) playVideo(entry.target);
      else entry.target.pause();
    });
  }, { threshold: 0.25 });
  videos.forEach((video) => cardVideoObserver.observe(video));
}

function toggleCardVideoSound(button) {
  const video = button.parentElement.querySelector('.product-card-video');
  video.muted = !video.muted;
  button.textContent = video.muted ? 'Unmute' : 'Mute';
  button.setAttribute('aria-label', video.muted ? 'Unmute product video' : 'Mute product video');
}

function toggleProductDescription(button) {
  const descriptionText = button.parentElement.querySelector('.description-text');
  const isExpanded = button.dataset.expanded === 'true';
  const fullDescription = button.dataset.fullDescription;
  descriptionText.textContent = isExpanded
    ? `${fullDescription.slice(0, PRODUCT_DESCRIPTION_LIMIT).trimEnd()}...`
    : fullDescription;
  button.textContent = isExpanded ? 'Read more' : 'Show less';
  button.dataset.expanded = String(!isExpanded);
}

function addToCart(productId, name, price, availableQuantity) {
  const selectedImage = getSelectedImage(productId);
  pendingCartItem = { productId, name, price, availableQuantity, selectedImage };
  document.getElementById('addToCartMessage').textContent = `Add ${name} to your cart?`;
  const image = document.getElementById('addToCartImage');
  image.src = selectedImage.url || 'https://via.placeholder.com/220x150?text=No+Image';
  image.alt = name;
  document.getElementById('addToCartModal').classList.remove('hidden');
}

function getSelectedImage(productId) {
  const selected = selectedImages[productId];
  const firstImage = productGallery[productId]?.find((media) => media.type === 'image');
  const image = selected?.type === 'image' ? selected : firstImage;
  return image ? { url: image.url || '', caption: image.caption || '' } : { url: '', caption: '' };
}

function closeAddToCartModal() {
  pendingCartItem = null;
  document.getElementById('addToCartModal').classList.add('hidden');
}

function confirmAddToCart() {
  if (!pendingCartItem) return;

  const { productId, name, price, availableQuantity, selectedImage } = pendingCartItem;

  const productQuantityInCart = cart
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
  if (productQuantityInCart >= availableQuantity) {
    showToast('You cannot add more than the available stock.', 'info');
    closeAddToCartModal();
    return;
  }
  const existing = cart.find((item) => item.productId === productId
    && item.selectedImage?.url === selectedImage.url);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ productId, name, price, quantity: 1, selectedImage });
  }
  updateCartUI();
  closeAddToCartModal();
}

function updateCartUI() {
  document.getElementById('cartCount').textContent = cart.reduce((sum, i) => sum + i.quantity, 0);

  const cartItemsDiv = document.getElementById('cartItems');
  cartItemsDiv.innerHTML = '';
  let total = 0;

  cart.forEach((item, index) => {
    total += item.price * item.quantity;
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <span>${item.name} x ${item.quantity}</span>
      <span>₵${(item.price * item.quantity).toFixed(2)} <button onclick="removeFromCart(${index})">✕</button></span>
    `;
    cartItemsDiv.appendChild(row);
  });

  document.getElementById('cartTotal').textContent = total.toFixed(2);
}

function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartUI();
}

document.getElementById('cartBtn').addEventListener('click', () => {
  document.getElementById('cartModal').classList.remove('hidden');
});
document.getElementById('closeCart').addEventListener('click', () => {
  document.getElementById('cartModal').classList.add('hidden');
});

document.getElementById('confirmAddToCart').addEventListener('click', confirmAddToCart);
document.getElementById('cancelAddToCart').addEventListener('click', closeAddToCartModal);
document.getElementById('cancelAddToCartAction').addEventListener('click', closeAddToCartModal);
document.getElementById('addToCartModal').addEventListener('click', (e) => {
  if (e.target.id === 'addToCartModal') closeAddToCartModal();
});

function openGallery(productId) {
  const gallery = productGallery[productId] || [];
  const galleryItems = document.getElementById('galleryItems');
  galleryItems.innerHTML = gallery.map((media, index) => {
    if (media.type === 'video') {
      return `
        <div class="gallery-item gallery-video" data-media-type="video">
          <video controls preload="metadata">
            <source src="${escapeHtml(media.url)}" type="${getVideoMimeType(media.url)}" />
            Your browser does not support this video format.
          </video>
          <span>${escapeHtml(media.caption || 'Product video')}</span>
        </div>
      `;
    }
    return `
      <button type="button" class="gallery-item${selectedImages[productId]?.url === media.url ? ' selected' : ''}" data-product-id="${productId}" data-media-type="image" data-image-index="${index}">
        <img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.caption || 'Product photo')}" />
        <span>${escapeHtml(media.caption || 'Select this photo')}</span>
      </button>
    `;
  }).join('');
  document.getElementById('galleryTitle').textContent = 'Product media';
  document.getElementById('galleryModal').classList.remove('hidden');
}

document.getElementById('galleryItems').addEventListener('click', (e) => {
  const item = e.target.closest('.gallery-item');
  if (!item || item.dataset.mediaType !== 'image') return;
  const productId = item.dataset.productId;
  const image = productGallery[productId][Number(item.dataset.imageIndex)];
  selectedImages[productId] = { url: image.url || '', caption: image.caption || '', type: 'image' };
  document.querySelectorAll('.gallery-item').forEach((galleryItem) => galleryItem.classList.remove('selected'));
  item.classList.add('selected');
  document.getElementById('galleryModal').classList.add('hidden');
});

function closeGallery() {
  document.getElementById('galleryModal').classList.add('hidden');
}

document.getElementById('closeGallery').addEventListener('click', closeGallery);
document.getElementById('galleryModal').addEventListener('click', (e) => {
  if (e.target.id === 'galleryModal') closeGallery();
});

async function finalizeOrder(orderData) {
  try {
    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });
    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.message || 'The backend rejected the order.');
    }

    const orderId = result.order?._id || 'unavailable';
    const confirmedItems = result.order?.items?.length ? result.order.items : cart;
    const receipt = {
      orderId,
      orderDate: result.order?.createdAt || new Date().toISOString(),
      companyName: document.getElementById('companyName').textContent || 'My Company',
      customerName: orderData.customerName,
      deliveryAddress: orderData.deliveryAddress,
      items: confirmedItems.map((item) => ({
        name: item.name,
        selectedImage: item.selectedImage || { url: '', caption: '' },
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity,
      })),
      totalAmount: result.order?.totalAmount ?? cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    };

    try {
      const receipts = JSON.parse(localStorage.getItem('receipts') || '[]');
      if (!Array.isArray(receipts)) throw new Error('Saved receipts data is invalid.');
      receipts.push(receipt);
      localStorage.setItem('receipts', JSON.stringify(receipts));
    } catch (storageError) {
      console.error('Could not save receipt locally:', storageError);
      showToast('Order placed, but the receipt could not be saved on this device.', 'error');
      return;
    }

    showToast(`Order placed! Your order ID is ${orderId} - save this to track your order.`, 'success');
    cart = [];
    updateCartUI();
    document.getElementById('checkoutForm').reset();
    document.getElementById('cartModal').classList.add('hidden');
    loadProducts();
    setTimeout(() => {
      window.location.href = '/receipt.html';
    }, 1200);
  } catch (err) {
    console.error('Finalizing order failed:', err);
    showToast('Failed to place order: ' + err.message, 'error');
  }
}

document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (cart.length === 0) {
    showToast('Your cart is empty.', 'info');
    return;
  }

  let config;
  try {
    const configRes = await fetch(`${API}/config`);
    if (!configRes.ok) throw new Error('Could not load payment configuration.');
    config = await configRes.json();
    if (!config.paystackPublicKey) throw new Error('Paystack is not configured.');
  } catch (err) {
    console.error('Paystack configuration failed:', err);
    showToast('Unable to start payment: ' + err.message, 'error');
    return;
  }

  const customerName = document.getElementById('customerName').value;
  const customerEmail = document.getElementById('customerEmail').value;
  const customerPhone = document.getElementById('customerPhone').value;
  const deliveryAddress = document.getElementById('deliveryAddress').value;
  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  try {
    if (typeof PaystackPop === 'undefined') throw new Error('Paystack checkout did not load.');

    const handler = PaystackPop.setup({
      key: config.paystackPublicKey,
      email: customerEmail,
      amount: Math.round(totalAmount * 100),
      currency: 'GHS',
      metadata: { customerName, customerPhone },
      callback: function(response) {
        finalizeOrder({
          customerName,
          customerEmail,
          customerPhone,
          deliveryAddress,
          items: cart.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            selectedImage: {
              url: i.selectedImage?.url || '',
              caption: i.selectedImage?.caption || '',
            },
          })),
          paystackReference: response.reference,
        });
      },
      onClose: function() {
      },
    });

    handler.openIframe();
  } catch (err) {
    console.error('Could not open Paystack checkout:', err);
    showToast('Unable to start payment: ' + err.message, 'error');
  }
});

loadProducts();
