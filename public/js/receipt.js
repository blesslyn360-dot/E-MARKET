// Bump the receipt.js query version in receipt.html whenever this file changes.
const THEME_KEY = 'theme';
let theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
let receipts = [];
let statusInterval = null;
let statusRequestId = 0;

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

document.getElementById('receiptYear').textContent = new Date().getFullYear();

document.getElementById('printReceipt').addEventListener('click', () => window.print());

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function formatCurrency(amount) {
  return `₵${Number(amount || 0).toFixed(2)}`;
}

async function loadCompanyInfo() {
  try {
    const response = await fetch('/api/company');
    if (!response.ok) throw new Error(`Company request failed with ${response.status}`);
    const info = await response.json();
    const companyName = info.companyName || 'Receipt';
    document.getElementById('receiptCompanyName').textContent = companyName;
    document.getElementById('receiptFooterCompany').textContent = companyName;
    document.getElementById('receiptTitle').textContent = companyName;
    ['receiptCompanyLogo', 'receiptBrandLogo'].forEach((id) => {
      const logo = document.getElementById(id);
      logo.src = info.logoUrl || '';
      logo.classList.toggle('hidden', !info.logoUrl);
    });
  } catch (err) {
    console.error('Could not load company info for receipt:', err);
    ['receiptCompanyName', 'receiptFooterCompany', 'receiptTitle'].forEach((id) => {
      document.getElementById(id).textContent = 'Receipt';
    });
  }
}

loadCompanyInfo();

function setStatusBadge(status, requestId) {
  if (requestId !== statusRequestId) return;

  const badge = document.getElementById('receiptStatus');
  const statusClass = String(status || '').toLowerCase();
  badge.className = `status-badge ${['pending', 'processing', 'completed', 'cancelled'].includes(statusClass) ? statusClass : 'unavailable'}`;
  badge.textContent = status || 'Status unavailable';
}

async function fetchReceiptStatus(receipt, requestId) {
  if (!receipt.orderId || receipt.orderId === 'unavailable') {
    setStatusBadge('', requestId);
    return;
  }

  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(receipt.orderId)}/status`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
    const data = await response.json();
    setStatusBadge(data.status, requestId);
  } catch (err) {
    console.error('Could not load receipt status:', err);
    setStatusBadge('', requestId);
  }
}

function stopStatusPolling() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

function startStatusPolling(receipt) {
  stopStatusPolling();
  statusRequestId += 1;
  const requestId = statusRequestId;
  fetchReceiptStatus(receipt, requestId);
  statusInterval = setInterval(() => fetchReceiptStatus(receipt, requestId), 15000);
}

function renderReceipt(receipt) {
  const companyName = receipt.companyName || '';
  document.getElementById('receiptCompanyName').textContent = companyName;
  document.getElementById('receiptFooterCompany').textContent = companyName;
  document.getElementById('receiptTitle').textContent = companyName;
  document.getElementById('receiptDate').textContent = new Date(receipt.orderDate).toLocaleString();
  document.getElementById('receiptCustomer').textContent = receipt.customerName || '';
  document.getElementById('receiptAddress').textContent = receipt.deliveryAddress || '';
  document.getElementById('receiptOrderId').textContent = receipt.orderId || '';
  document.getElementById('receiptTotal').textContent = formatCurrency(receipt.totalAmount);

  document.getElementById('receiptItems').innerHTML = (receipt.items || []).map((item) => {
    const image = item.selectedImage?.url
      ? `<img src="${escapeHtml(item.selectedImage.url)}" alt="${escapeHtml(item.selectedImage.caption || item.name)}" />`
      : '';
    const caption = item.selectedImage?.caption
      ? `<span class="receipt-caption">${escapeHtml(item.selectedImage.caption)}</span>`
      : '';
    const subtotal = item.subtotal ?? item.price * item.quantity;
    return `<tr>
      <td><div class="receipt-item">${image}<span><strong>${escapeHtml(item.name)}</strong>${caption}</span></div></td>
      <td>${escapeHtml(item.quantity)}</td>
      <td>${formatCurrency(item.price)}</td>
      <td>${formatCurrency(subtotal)}</td>
    </tr>`;
  }).join('');

  document.getElementById('receiptContent').classList.remove('hidden');
  document.getElementById('emptyReceipt').classList.add('hidden');
  startStatusPolling(receipt);
}

function populateSelector() {
  const selector = document.getElementById('receiptSelector');
  selector.innerHTML = receipts.map((receipt, index) =>
    `<option value="${index}">${escapeHtml(receipt.orderId || `Receipt ${index + 1}`)} - ${escapeHtml(new Date(receipt.orderDate).toLocaleDateString())}</option>`
  ).join('');
  selector.classList.toggle('hidden', receipts.length < 2);
}

function loadReceipts() {
  try {
    const saved = JSON.parse(localStorage.getItem('receipts') || '[]');
    receipts = Array.isArray(saved)
      ? saved.slice().sort((left, right) => new Date(right.orderDate).getTime() - new Date(left.orderDate).getTime())
      : [];
  } catch (err) {
    console.error('Could not read saved receipts:', err);
    receipts = [];
  }

  if (receipts.length === 0) {
    document.getElementById('emptyReceipt').classList.remove('hidden');
    document.getElementById('receiptContent').classList.add('hidden');
    document.getElementById('receiptSelector').classList.add('hidden');
    return;
  }

  populateSelector();
  renderReceipt(receipts[0]);
  document.getElementById('receiptSelector').value = '0';
}

document.getElementById('receiptSelector').addEventListener('change', (event) => {
  renderReceipt(receipts[Number(event.target.value)]);
});

window.addEventListener('pagehide', stopStatusPolling);
window.addEventListener('beforeunload', stopStatusPolling);

loadReceipts();
