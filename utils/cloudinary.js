const cloudinary = require('../config/cloudinary');

function getAssetInfo(asset) {
  if (!asset) return null;
  if (typeof asset === 'object' && (asset.public_id || asset.filename)) {
    return {
      publicId: asset.public_id || asset.filename,
      resourceType: asset.resource_type || (asset.mimetype?.startsWith('video/') ? 'video' : 'image'),
    };
  }
  if (typeof asset !== 'string' || !asset.includes('res.cloudinary.com/')) return null;

  const marker = asset.includes('/video/upload/') ? '/video/upload/' : '/image/upload/';
  const uploadIndex = asset.indexOf(marker);
  if (uploadIndex === -1) return null;
  const path = asset.slice(uploadIndex + marker.length).split('?')[0];
  const segments = path.split('/').filter(Boolean);
  if (segments[0]?.match(/^v\d+$/)) segments.shift();
  if (!segments.length) return null;
  const lastSegment = segments.pop().replace(/\.[^.]+$/, '');
  return {
    publicId: [...segments, lastSegment].join('/'),
    resourceType: marker.startsWith('/video/') ? 'video' : 'image',
  };
}

async function deleteCloudinaryAsset(asset) {
  const info = getAssetInfo(asset);
  if (!info) return;
  try {
    await cloudinary.uploader.destroy(info.publicId, {
      resource_type: info.resourceType,
      invalidate: true,
    });
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
}

module.exports = { deleteCloudinaryAsset };
