/**
 * Compress an image file in-browser using a canvas element.
 * Resizes to maxWidthPx and re-encodes as JPEG to keep upload size
 * under maxBytes — prevents hitting the 5 MB Anthropic image limit.
 * Falls back to the original file silently if canvas is unavailable.
 */
export async function compressImage(
  file: File,
  maxWidthPx = 1400,
  quality = 0.82,
  maxBytes = 1.4 * 1024 * 1024,
): Promise<Blob> {
  return new Promise(resolve => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      let { width, height } = img
      if (width > maxWidthPx) {
        height = Math.round((height * maxWidthPx) / width)
        width = maxWidthPx
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }

      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return }
        if (blob.size <= maxBytes) { resolve(blob); return }
        // Still over limit — try harder compression
        canvas.toBlob(blob2 => resolve(blob2 ?? file), 'image/jpeg', 0.6)
      }, 'image/jpeg', quality)
    }

    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file) }
    img.src = objectUrl
  })
}
