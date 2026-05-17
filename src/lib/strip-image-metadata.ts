import imageCompression from 'browser-image-compression'

// Image MIME types whose metadata we can safely strip by re-encoding through a
// canvas. Animated formats (GIF, animated WebP/PNG) and videos are excluded on
// purpose: re-encoding would flatten animation, and they rarely carry
// sensitive metadata such as GPS coordinates.
const STRIPPABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Remove potentially sensitive metadata (EXIF/GPS, XMP, thumbnails, ...) from
 * an image file before it is uploaded.
 *
 * It re-draws the image onto a canvas and re-encodes it once, which drops
 * every metadata block while keeping the pixels. This strips metadata only:
 * the image is not resized and not compressed (re-encoded at maximum quality).
 *
 * Unsupported file types are returned unchanged so uploads never break.
 */
export async function stripImageMetadata(file: File): Promise<File> {
  if (!STRIPPABLE_IMAGE_TYPES.has(file.type)) {
    return file
  }

  try {
    const [source, canvas] = await imageCompression.drawFileInCanvas(file)
    const stripped = await imageCompression.canvasToFile(
      canvas,
      file.type,
      file.name,
      file.lastModified,
      1 // maximum quality: strip metadata only, do not compress
    )

    // Release memory eagerly (iOS Safari has tight canvas memory limits).
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
      source.close()
    }
    canvas.width = 0
    canvas.height = 0

    return stripped
  } catch {
    // If anything goes wrong, fall back to the original file rather than
    // blocking the upload.
    return file
  }
}
