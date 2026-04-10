import sharp from "sharp";
import path from "node:path";
import fsSync from "node:fs";

export interface ImageVariant {
  url: string;
  width: number | null;
  height: number | null;
}

export interface ImageProcessingResult {
  thumb: ImageVariant;
  medium: ImageVariant;
  original: ImageVariant;
}

// Image variant sizes
const THUMB_MAX = 300;  // Small preview (QR codes are small anyway)
const MEDIUM_MAX = 1200; // Standard display size

/**
 * Process an image buffer: convert to WebP and generate thumb + medium variants.
 * Non-image files pass through unchanged.
 *
 * Returns URLs relative to the uploads directory prefix "/api/uploads/".
 */
export async function processImage(
  buffer: Buffer,
  mimeType: string,
  uploadsDir: string,
  prefix: string, // e.g. "qrcode" or "avatar"
): Promise<ImageProcessingResult | null> {
  // Only process actual image types
  const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff"];
  if (!imageTypes.includes(mimeType)) {
    return null; // Not an image — caller should handle the raw file
  }

  const timestamp = Date.now();
  const baseName = `${prefix}_${timestamp}`;
  const dir = path.resolve(uploadsDir, prefix);

  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }

  // --- Process with sharp ---
  const pipeline = sharp(buffer);
  const metadata = await pipeline.metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;

  // Convert to WebP
  const webpBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
  const webpMeta = await sharp(webpBuffer).metadata();
  const webpWidth = webpMeta.width ?? originalWidth;
  const webpHeight = webpMeta.height ?? originalHeight;

  // Save original as WebP
  const originalFilename = `${baseName}_original.webp`;
  const originalPath = path.resolve(dir, originalFilename);
  fsSync.writeFileSync(originalPath, webpBuffer);

  // Generate medium variant (max 1200px)
  let mediumFilename = originalFilename;
  let mediumWidth = webpWidth;
  let mediumHeight = webpHeight;
  if (Math.max(webpWidth, webpHeight) > MEDIUM_MAX) {
    const mediumPipeline = sharp(webpBuffer).resize(MEDIUM_MAX, MEDIUM_MAX, { fit: "inside", withoutEnlargement: true });
    const mediumBuffer = await mediumPipeline.webp({ quality: 82 }).toBuffer();
    const mediumMeta = await sharp(mediumBuffer).metadata();
    mediumFilename = `${baseName}_medium.webp`;
    mediumWidth = mediumMeta.width ?? webpWidth;
    mediumHeight = mediumMeta.height ?? webpHeight;
    fsSync.writeFileSync(path.resolve(dir, mediumFilename), mediumBuffer);
  }

  // Generate thumbnail (max 300px)
  let thumbFilename = originalFilename;
  let thumbWidth = mediumWidth;
  let thumbHeight = mediumHeight;
  if (Math.max(mediumWidth, mediumHeight) > THUMB_MAX) {
    const thumbPipeline = sharp(webpBuffer).resize(
      mediumWidth >= mediumHeight ? THUMB_MAX : undefined,
      mediumWidth >= mediumHeight ? undefined : THUMB_MAX,
      { withoutEnlargement: true },
    );
    const thumbBuffer = await thumbPipeline.webp({ quality: 78 }).toBuffer();
    const thumbMeta = await sharp(thumbBuffer).metadata();
    thumbFilename = `${baseName}_thumb.webp`;
    thumbWidth = thumbMeta.width ?? THUMB_MAX;
    thumbHeight = thumbMeta.height ?? THUMB_MAX;
    fsSync.writeFileSync(path.resolve(dir, thumbFilename), thumbBuffer);
  }

  return {
    thumb: { url: `/api/uploads/${prefix}/${thumbFilename}`, width: thumbWidth, height: thumbHeight },
    medium: { url: `/api/uploads/${prefix}/${mediumFilename}`, width: mediumWidth, height: mediumHeight },
    original: { url: `/api/uploads/${prefix}/${originalFilename}`, width: webpWidth, height: webpHeight },
  };
}

/**
 * Delete image variant files when a group QR code is replaced or removed.
 */
export function deleteImageVariants(uploadsDir: string, prefix: string, timestamp: number) {
  const dir = path.resolve(uploadsDir, prefix);
  if (!fsSync.existsSync(dir)) return;

  const files = fsSync.readdirSync(dir);
  const baseName = `${prefix}_${timestamp}`;
  for (const file of files) {
    if (file.startsWith(baseName)) {
      try {
        fsSync.unlinkSync(path.resolve(dir, file));
      } catch {
        // Ignore deletion errors
      }
    }
  }
}
