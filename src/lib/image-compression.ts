import imageCompression from 'browser-image-compression'

// Image MIME types that can be compressed by re-encoding through a canvas.
// Animated formats (GIF, animated WebP/PNG) and videos are excluded: they
// would lose animation or are too costly to re-encode in the browser.
const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type TImageCompressionOptions = {
  /** Downscale the image so its longest side is at most this many pixels. */
  maxWidthOrHeight?: number
  /** Compress the image until it is at most this many megabytes. */
  maxSizeMB?: number
}

/**
 * Shrink an oversized image before upload. The image is downscaled and/or
 * compressed only when it exceeds the given limits; smaller images keep their
 * resolution and are never upscaled. Re-encoding also drops sensitive
 * metadata (EXIF/GPS, ...), so a separate stripping pass is unnecessary.
 *
 * Unsupported file types are returned unchanged so uploads never break.
 */
export async function compressImage(
  file: File,
  options: TImageCompressionOptions
): Promise<File> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
    return file
  }

  try {
    return await imageCompression(file, {
      maxWidthOrHeight: options.maxWidthOrHeight,
      maxSizeMB: options.maxSizeMB ?? Number.POSITIVE_INFINITY,
      fileType: file.type,
      useWebWorker: false // avoid loading the library from a CDN inside a worker
    })
  } catch {
    // If compression fails for any reason, fall back to the original file
    // rather than blocking the upload.
    return file
  }
}
