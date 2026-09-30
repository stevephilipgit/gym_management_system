// utils/imageProcessor.js — one reusable member-photo processor (plan §6).
//
// Every admin/trainer screen funnels photo files through processMemberPhoto():
//   decode (EXIF oriented) → square passport crop → resize ~300×300
//   → WebP (JPEG fallback when the browser cannot encode WebP)
//   → hard ≤300 KB cap (quality, then scale, then a clear error)
//
// Deliberately free of API calls and business logic: file in, blob out.

const DEFAULT_SIZE = 300;
const DEFAULT_MAX_BYTES = 300 * 1024;
const MAX_ITERATIONS = 6;
const MIN_SIZE = 96;

const UNREADABLE =
  "Could not read this image file. Please choose a JPG or PNG photo.";
const TOO_LARGE =
  "Photo is too large even after compression. Please choose a smaller image.";

let webpSupportCache;

/** Feature-detect WebP encoding — plan §6 forbids assuming support. */
export function supportsWebP() {
  if (webpSupportCache !== undefined) return webpSupportCache;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupportCache =
      canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
  } catch {
    webpSupportCache = false;
  }
  return webpSupportCache;
}

async function decodeImage(file) {
  // Preferred: decode with EXIF orientation applied to the pixels.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through */
    }
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  // Fallback: browsers apply EXIF when decoding through <img>.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Center-crop to a square (passport framing) and render at `size`. */
function drawCover(source, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const width = source.width ?? source.naturalWidth;
  const height = source.height ?? source.naturalHeight;
  if (!width || !height) throw new Error(UNREADABLE);
  const side = Math.min(width, height);
  ctx.drawImage(
    source,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size
  );
  return canvas;
}

function rescale(canvas, size) {
  const next = document.createElement("canvas");
  next.width = size;
  next.height = size;
  next.getContext("2d").drawImage(canvas, 0, 0, size, size);
  return next;
}

const toBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Process a photo file for upload.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {number} [options.size]    target edge length in px (default 300)
 * @param {number} [options.maxBytes] hard cap (default 300 KB, plan §6)
 * @returns {Promise<{blob: Blob, contentType: string, extension: string,
 *   width: number, height: number}>}
 * @throws when the file cannot be decoded or cannot be compressed under the cap
 */
export async function processMemberPhoto(
  file,
  { size = DEFAULT_SIZE, maxBytes = DEFAULT_MAX_BYTES } = {}
) {
  if (!file || !(file instanceof Blob)) throw new Error(UNREADABLE);
  if (file.type && !file.type.startsWith("image/")) throw new Error(UNREADABLE);

  let source;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error(UNREADABLE);
  }

  try {
    const type = supportsWebP() ? "image/webp" : "image/jpeg";
    const extension = type === "image/webp" ? "webp" : "jpeg";

    let canvas = drawCover(source, size);
    let currentSize = size;
    let quality = 0.82;
    let blob = await toBlob(canvas, type, quality);

    for (let i = 0; i < MAX_ITERATIONS && blob && blob.size > maxBytes; i += 1) {
      if (quality > 0.6) {
        quality = 0.6;
      } else {
        currentSize = Math.max(MIN_SIZE, Math.round(currentSize * 0.75));
        canvas = rescale(canvas, currentSize);
      }
      const next = await toBlob(canvas, type, quality);
      if (!next || next.size >= blob.size) break; // no further gain
      blob = next;
    }

    if (!blob || blob.size > maxBytes) throw new Error(TOO_LARGE);

    return {
      blob,
      contentType: type,
      extension,
      width: currentSize,
      height: currentSize,
    };
  } finally {
    if ("close" in source && typeof source.close === "function") source.close();
  }
}
