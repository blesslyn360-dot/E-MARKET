// Bump the admin.js query version in admin.html whenever this file changes.
const API = '/api';
let token = localStorage.getItem('adminToken') || '';
const THEME_KEY = 'theme';
const MAX_PRODUCT_IMAGES = 20;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2000;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
let theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';

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

function showConfirmModal(message, onConfirm) {
  const modal = document.getElementById('adminConfirmModal');
  const closeButton = document.getElementById('cancelAdminConfirm');
  const cancelButton = document.getElementById('cancelAdminConfirmAction');
  const confirmButton = document.getElementById('confirmAdminAction');

  document.getElementById('adminConfirmMessage').textContent = message;
  modal.classList.remove('hidden');

  const closeModal = () => {
    modal.classList.add('hidden');
    closeButton.removeEventListener('click', closeModal);
    cancelButton.removeEventListener('click', closeModal);
    modal.removeEventListener('click', handleBackdropClick);
    confirmButton.removeEventListener('click', confirmAction);
  };
  const handleBackdropClick = (event) => {
    if (event.target === modal) closeModal();
  };
  const confirmAction = () => {
    closeModal();
    onConfirm();
  };

  closeButton.addEventListener('click', closeModal);
  cancelButton.addEventListener('click', closeModal);
  modal.addEventListener('click', handleBackdropClick);
  confirmButton.addEventListener('click', confirmAction);
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

function showDashboard() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('dashboardView').classList.remove('hidden');
  loadAdminProducts().catch((err) => showToast(`Failed to load products: ${err.message}`, 'error'));
  loadOrders().catch((err) => showToast(`Failed to load orders: ${err.message}`, 'error'));
  loadCompanyForAdmin().catch((err) => showToast(`Failed to load company info: ${err.message}`, 'error'));
}
function showLogin() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('dashboardView').classList.add('hidden');
}

if (token) showDashboard(); else showLogin();

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (res.ok) {
      token = data.token;
      localStorage.setItem('adminToken', token);
      showDashboard();
    } else {
      document.getElementById('loginError').textContent = data.message || 'Login failed.';
    }
  } catch (err) {
    document.getElementById('loginError').textContent = 'Unable to reach the server. Please try again.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('adminToken');
  token = '';
  showLogin();
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.remove('hidden');
  });
});

async function authFetch(url, options = {}) {
  options.headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(url, options);
  if (res.status === 401) {
    localStorage.removeItem('adminToken');
    token = '';
    showLogin();
    throw new Error('Session expired');
  }
  return res;
}

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      onProgress(100);
      let data = {};
      try {
        data = JSON.parse(request.responseText || '{}');
      } catch (err) {
        data = { message: 'The server returned an invalid response.' };
      }
      if (request.status === 401) {
        localStorage.removeItem('adminToken');
        token = '';
        showLogin();
        reject(new Error('Session expired'));
        return;
      }
      resolve({ ok: request.status >= 200 && request.status < 300, data });
    });
    request.addEventListener('error', () => reject(new Error('Network error while uploading product media.')));
    request.addEventListener('abort', () => reject(new Error('Product upload was cancelled.')));
    request.send(formData);
  });
}

let editingProductId = null;
let editImages = [];
let editVideos = [];

function escapeAttribute(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function optimizeProductImage(file) {
  if (!file.type.startsWith('image/')
    || file.size <= MAX_IMAGE_UPLOAD_BYTES
    || file.type === 'image/png'
    || file.type === 'image/gif') return Promise.resolve(file);

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) return resolve(file);
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
          type: 'image/jpeg',
          lastModified: file.lastModified,
        }));
      }, 'image/jpeg', 0.82);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    image.src = objectUrl;
  });
}

async function optimizeProductImages(files, statusElement) {
  const optimizedFiles = [];
  for (let index = 0; index < files.length; index += 1) {
    statusElement.textContent = `Preparing image ${index + 1} of ${files.length}...`;
    optimizedFiles.push(await optimizeProductImage(files[index]));
  }
  return optimizedFiles;
}

function renderEditMedia(type) {
  const media = type === 'images' ? editImages : editVideos;
  const container = document.getElementById(type === 'images' ? 'editImages' : 'editVideos');
  container.innerHTML = '';

  media.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'edit-media-row';
    row.innerHTML = type === 'images'
      ? `<img src="${item.url}" alt="Existing product image" />`
        + `<label class="edit-media-description">Image ${index + 1} description<input type="text" value="${escapeAttribute(item.caption)}" data-media-index="${index}" aria-label="Description for existing image ${index + 1}" placeholder="Describe this image (color, angle, details)" /></label>`
        + '<button type="button" class="remove-media-btn">Remove</button>'
      : `<video src="${item.url}" muted controls preload="metadata" aria-label="Existing product video"></video>`
        + `<label class="edit-media-description">Video ${index + 1} description<input type="text" value="${escapeAttribute(item.caption)}" data-media-index="${index}" aria-label="Description for existing video ${index + 1}" placeholder="Description for video ${index + 1}" /></label>`
        + '<button type="button" class="remove-media-btn">Remove</button>';
    row.querySelector('.remove-media-btn').addEventListener('click', () => {
      showConfirmModal(`Remove this ${type === 'images' ? 'image' : 'video'} from the product?`, () => {
        media.splice(index, 1);
        renderEditMedia(type);
      });
    });
    container.appendChild(row);
  });
}

function renderNewMediaPreviews(inputId, containerId, type) {
  const input = document.getElementById(inputId);
  const files = [...input.files];
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  files.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = `image-caption-row${containerId.includes('edit') ? ' edit-new-media-row' : ''}`;
    const preview = type === 'images'
      ? `<img src="${URL.createObjectURL(file)}" alt="Preview of ${file.name}" />`
      : `<video src="${URL.createObjectURL(file)}" muted controls preload="metadata" aria-label="Preview of ${file.name}"></video>`;
    const placeholder = type === 'images'
      ? 'Describe this image (color, angle, details)'
      : 'Describe this video';
    row.innerHTML = `${preview}<span>${file.name}</span><input type="text" data-caption-index="${index}" aria-label="Description for new ${type === 'images' ? 'image' : 'video'} ${index + 1}" placeholder="${placeholder}" /><button type="button" class="remove-selected-media" aria-label="Remove ${type === 'images' ? 'image' : 'video'} ${index + 1}">Remove</button>`;
    row.querySelector('.remove-selected-media').addEventListener('click', () => {
      removeSelectedFile(inputId, containerId, type, index);
    });
    container.appendChild(row);
  });
}

function removeSelectedFile(inputId, containerId, type, index) {
  const input = document.getElementById(inputId);
  const files = [...input.files];
  const dataTransfer = new DataTransfer();
  files.forEach((file, fileIndex) => {
    if (fileIndex !== index) dataTransfer.items.add(file);
  });
  input.files = dataTransfer.files;
  renderNewMediaPreviews(inputId, containerId, type);
}

async function editProduct(id) {
  try {
    const res = await fetch(`${API}/products`);
    const products = await res.json();
    const product = products.find((item) => item._id === id);
    if (!product) throw new Error('Product not found.');

    editingProductId = id;
    editImages = product.images?.length
      ? product.images.map((image) => ({ url: image.url, caption: image.caption || '' }))
      : (product.imageUrl ? [{ url: product.imageUrl, caption: '' }] : []);
    editVideos = (product.videos || []).map((video) => ({ url: video.url, caption: video.caption || '' }));
    document.getElementById('editName').value = product.name || '';
    document.getElementById('editDescription').value = product.description || '';
    document.getElementById('editPrice').value = product.price;
    document.getElementById('editQuantity').value = product.quantity;
    document.getElementById('editCategory').value = product.category || '';
    document.getElementById('editImageFiles').value = '';
    document.getElementById('editVideoFiles').value = '';
    document.getElementById('editImageCaptions').innerHTML = '';
    document.getElementById('editVideoCaptions').innerHTML = '';
    renderEditMedia('images');
    renderEditMedia('videos');
    document.getElementById('editProductPanel').classList.remove('hidden');
    document.getElementById('editProductPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showToast(`Failed to load product: ${err.message}`, 'error');
  }
}

function closeEditProduct() {
  editingProductId = null;
  editImages = [];
  editVideos = [];
  document.getElementById('editProductForm').reset();
  document.getElementById('editImageCaptions').innerHTML = '';
  document.getElementById('editVideoCaptions').innerHTML = '';
  document.getElementById('editProductPanel').classList.add('hidden');
}

document.getElementById('editImageFiles').addEventListener('change', () => {
  const files = [...document.getElementById('editImageFiles').files];
  if (editImages.length + files.length > MAX_PRODUCT_IMAGES) {
    showToast(`A product can have a maximum of ${MAX_PRODUCT_IMAGES} images.`, 'error');
    document.getElementById('editImageFiles').value = '';
    return;
  }
  renderNewMediaPreviews('editImageFiles', 'editImageCaptions', 'images');
});

document.getElementById('editVideoFiles').addEventListener('change', () => {
  const files = [...document.getElementById('editVideoFiles').files];
  if (editVideos.length + files.length > 2) {
    showToast('A product can have a maximum of 2 videos.', 'error');
    document.getElementById('editVideoFiles').value = '';
    return;
  }
  const invalidVideo = files.find((file) => file.size > MAX_VIDEO_SIZE
    || !ALLOWED_VIDEO_TYPES.includes(file.type));
  if (invalidVideo) {
    showToast(`${invalidVideo.name} must be an MP4, WebM, or QuickTime video no larger than 50MB.`, 'error');
    document.getElementById('editVideoFiles').value = '';
    return;
  }
  renderNewMediaPreviews('editVideoFiles', 'editVideoCaptions', 'videos');
});

document.getElementById('cancelEditProduct').addEventListener('click', closeEditProduct);

document.getElementById('editProductForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const imageCaptionInputs = [...document.querySelectorAll('#editImages input[data-media-index]')];
  const videoCaptionInputs = [...document.querySelectorAll('#editVideos input[data-media-index]')];
  editImages = editImages.map((image, index) => ({ ...image, caption: imageCaptionInputs[index]?.value || '' }));
  editVideos = editVideos.map((video, index) => ({ ...video, caption: videoCaptionInputs[index]?.value || '' }));
  const imageFiles = [...document.getElementById('editImageFiles').files];
  const videoFiles = [...document.getElementById('editVideoFiles').files];
  const formData = new FormData();
  formData.append('name', document.getElementById('editName').value);
  formData.append('description', document.getElementById('editDescription').value);
  formData.append('price', document.getElementById('editPrice').value);
  formData.append('quantity', document.getElementById('editQuantity').value);
  formData.append('category', document.getElementById('editCategory').value);
  formData.append('keepImages', JSON.stringify(editImages.map((image) => image.url)));
  formData.append('keepImageCaptions', JSON.stringify(editImages.map((image) => image.caption)));
  formData.append('keepVideos', JSON.stringify(editVideos.map((video) => video.url)));
  formData.append('keepVideoCaptions', JSON.stringify(editVideos.map((video) => video.caption)));
  imageFiles.forEach((file) => formData.append('images', file));
  videoFiles.forEach((file) => formData.append('videos', file));
  formData.append('newImageCaptions', JSON.stringify([...document.querySelectorAll('#editImageCaptions input')].map((input) => input.value)));
  formData.append('newVideoCaptions', JSON.stringify([...document.querySelectorAll('#editVideoCaptions input')].map((input) => input.value)));

  try {
    const res = await authFetch(`${API}/products/${editingProductId}`, { method: 'PUT', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to update product.');
    showToast('Product updated.', 'success');
    closeEditProduct();
    await loadAdminProducts();
  } catch (err) {
    showToast(`Failed to update product: ${err.message}`, 'error');
  }
});

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitButton = e.submitter || e.currentTarget.querySelector('button[type="submit"]');
  const uploadStatus = document.getElementById('productUploadStatus');
  submitButton.disabled = true;
  uploadStatus.classList.remove('hidden');
  try {
    const formData = new FormData();
    formData.append('name', document.getElementById('pName').value);
    formData.append('description', document.getElementById('pDescription').value);
    formData.append('price', document.getElementById('pPrice').value);
    formData.append('quantity', document.getElementById('pQuantity').value);
    formData.append('category', document.getElementById('pCategory').value);
    const imageFiles = [...document.getElementById('pImage').files];
    const videoFiles = [...document.getElementById('pVideo').files];
    if (videoFiles.length > 2) throw new Error('You can upload a maximum of 2 product videos.');
    const invalidVideo = videoFiles.find((file) => file.size > MAX_VIDEO_SIZE
      || !ALLOWED_VIDEO_TYPES.includes(file.type));
    if (invalidVideo) throw new Error(`${invalidVideo.name} must be an MP4, WebM, or QuickTime video no larger than 50MB.`);
    const captions = [...document.querySelectorAll('#imageCaptions input')].map((input) => input.value);
    const videoCaptions = [...document.querySelectorAll('#videoCaptions input')].map((input) => input.value);
    const optimizedImageFiles = await optimizeProductImages(imageFiles, uploadStatus);
    optimizedImageFiles.forEach((imageFile) => formData.append('images', imageFile));
    videoFiles.forEach((videoFile) => formData.append('videos', videoFile));
    formData.append('captions', JSON.stringify(captions));
    formData.append('videoCaptions', JSON.stringify(videoCaptions));

    uploadStatus.textContent = 'Uploading product media... 0%';
    const result = await uploadWithProgress(`${API}/products`, formData, (percent) => {
      uploadStatus.textContent = `Uploading product media... ${percent}%`;
    });
    if (!result.ok) throw new Error(result.data.message || 'Upload failed.');
    document.getElementById('productForm').reset();
    document.getElementById('imageCaptions').innerHTML = '';
    document.getElementById('videoCaptions').innerHTML = '';
    uploadStatus.textContent = 'Product added successfully.';
    await loadAdminProducts();
  } catch (err) {
    showToast(`Failed to add product: ${err.message}`, 'error');
    uploadStatus.textContent = 'Upload failed. Please try again.';
  } finally {
    submitButton.disabled = false;
    setTimeout(() => uploadStatus.classList.add('hidden'), 3000);
  }
});

document.getElementById('cancelAddProduct').addEventListener('click', () => {
  document.getElementById('productForm').reset();
  document.getElementById('imageCaptions').innerHTML = '';
  document.getElementById('videoCaptions').innerHTML = '';
});

document.getElementById('pImage').addEventListener('change', (e) => {
  if (e.target.files.length > MAX_PRODUCT_IMAGES) {
    showToast(`You can upload a maximum of ${MAX_PRODUCT_IMAGES} product images.`, 'error');
    e.target.value = '';
    document.getElementById('imageCaptions').innerHTML = '';
    return;
  }
  renderNewMediaPreviews('pImage', 'imageCaptions', 'images');
});

document.getElementById('pVideo').addEventListener('change', (e) => {
  renderNewMediaPreviews('pVideo', 'videoCaptions', 'videos');
});

async function loadAdminProducts() {
  const res = await fetch(`${API}/products`);
  const products = await res.json();
  const list = document.getElementById('adminProductList');
  list.innerHTML = '';

  products.forEach((p) => {
    const images = p.images?.length
      ? p.images
      : (p.imageUrl ? [{ url: p.imageUrl, caption: '' }] : []);
    const imagePreviews = images.map((image) => `
      <div class="admin-image-preview">
        <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.caption || p.name)}" />
        ${image.caption ? `<span>${escapeHtml(image.caption)}</span>` : ''}
      </div>
    `).join('');
    const videoPreviews = (p.videos || []).map((video) => `
      <div class="admin-image-preview">
        <video src="${escapeAttribute(video.url)}" controls muted preload="metadata" aria-label="${escapeAttribute(video.caption || `${p.name} video`)}"></video>
        ${video.caption ? `<span>${escapeHtml(video.caption)}</span>` : ''}
      </div>
    `).join('');
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML = `
      <h4>${escapeHtml(p.name)} — ₵${Number(p.price).toFixed(2)}</h4>
      <div class="admin-image-previews">${imagePreviews}${videoPreviews}</div>
      <p>Qty: ${p.quantity} | Category: ${escapeHtml(p.category || 'General')}</p>
      <button class="edit-btn" onclick="editProduct('${p._id}')">Edit</button>
      <button class="delete-btn" onclick="deleteProduct('${p._id}')">Delete</button>
    `;
    list.appendChild(div);
  });
}

async function deleteProduct(id) {
  showConfirmModal('Delete this product?', async () => {
    await authFetch(`${API}/products/${id}`, { method: 'DELETE' });
    loadAdminProducts().catch((err) => showToast(`Failed to refresh products: ${err.message}`, 'error'));
  });
}

async function loadOrders() {
  const res = await authFetch(`${API}/orders`);
  const orders = await res.json();
  const list = document.getElementById('ordersList');
  list.innerHTML = '';

  if (orders.length === 0) {
    list.innerHTML = '<p>No orders yet.</p>';
    return;
  }

  orders.forEach((o) => {
    const itemsList = o.items.map((i) => `
      <div class="order-line-item">
        <div class="order-line-details">
          <strong>${escapeHtml(i.name)} x ${i.quantity}</strong>
          ${i.selectedImage?.url ? `<img src="${escapeAttribute(i.selectedImage.url)}" alt="${escapeAttribute(i.selectedImage.caption || i.name)}" />` : ''}
          ${i.selectedImage?.caption ? `<span>${escapeHtml(i.selectedImage.caption)}</span>` : ''}
        </div>
      </div>
    `).join('');
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML = `
      <p><strong>Order ID:</strong> ${o._id}</p>
      <h4>${o.customerName} — ₵${o.totalAmount.toFixed(2)}</h4>
      <p>Email: ${o.customerEmail} | Phone: ${o.customerPhone}</p>
      <p>Address: ${o.deliveryAddress}</p>
      <div class="order-items"><strong>Items:</strong>${itemsList}</div>
      <p>Placed: ${new Date(o.createdAt).toLocaleString()}</p>
      <select class="status-select" onchange="updateOrderStatus('${o._id}', this.value)">
        ${['Pending', 'Processing', 'Completed', 'Cancelled']
          .map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`)
          .join('')}
      </select>
      <button class="delete-btn" onclick="deleteOrder('${o._id}')">Delete</button>
    `;
    list.appendChild(div);
  });
}

async function deleteOrder(id) {
  showConfirmModal('Delete this order?', async () => {
    try {
      const res = await authFetch(`${API}/orders/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to delete order.');

      showToast('Order deleted.', 'success');
      await loadOrders();
    } catch (err) {
      showToast(`Failed to delete order: ${err.message}`, 'error');
    }
  });
}

async function updateOrderStatus(id, status) {
  await authFetch(`${API}/orders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

async function loadCompanyForAdmin() {
  const res = await fetch(`${API}/company`);
  const info = await res.json();
  document.getElementById('cName').value = info.companyName || '';
  document.getElementById('cTagline').value = info.tagline || '';
  document.getElementById('cAbout').value = info.aboutUs || '';
  document.getElementById('cEmail').value = info.email || '';
  document.getElementById('cPhone').value = info.phone || '';
  document.getElementById('cAddress').value = info.address || '';
  document.getElementById('cFacebook').value = info.facebook || '';
  document.getElementById('cInstagram').value = info.instagram || '';
  document.getElementById('cWhatsapp').value = info.whatsapp || '';
  document.getElementById('cTiktok').value = info.tiktok || '';
  document.getElementById('cSnapchat').value = info.snapchat || '';
  const logo = document.getElementById('adminCompanyLogo');
  const preview = document.getElementById('companyLogoPreview');
  [logo, preview].forEach((image) => {
    image.src = info.logoUrl || '';
    image.classList.toggle('hidden', !info.logoUrl);
  });
}

document.getElementById('companyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData();
  const fields = {
    companyName: 'cName',
    tagline: 'cTagline',
    aboutUs: 'cAbout',
    email: 'cEmail',
    phone: 'cPhone',
    address: 'cAddress',
    facebook: 'cFacebook',
    instagram: 'cInstagram',
    whatsapp: 'cWhatsapp',
    tiktok: 'cTiktok',
    snapchat: 'cSnapchat',
  };
  Object.entries(fields).forEach(([field, elementId]) => {
    formData.append(field, document.getElementById(elementId).value);
  });
  const logoFile = document.getElementById('companyLogo').files[0];
  if (logoFile) formData.append('logo', logoFile);

  try {
    const res = await authFetch(`${API}/company`, { method: 'PUT', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to update company information.');
    showToast('Company information updated.', 'success');
    await loadCompanyForAdmin();
  } catch (err) {
    showToast(`Failed to update company information: ${err.message}`, 'error');
  }
});

document.getElementById('companyLogo').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.getElementById('companyLogoPreview');
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
});
