/**
 * Compresses an image file (JPEG, PNG, WEBP) using HTML Canvas in the browser.
 * Resizes the image so that its maximum dimension does not exceed `maxWidth`,
 * and exports it as a WebP image to ensure lightweight uploads (< 500KB).
 * If the file is not an image (e.g. PDF), returns the original file untouched.
 */
export async function compressImageFile(
  file: File,
  maxWidth = 1200,
  quality = 0.8
): Promise<File> {
  // If not running in browser or file is not an image, return untouched
  if (typeof window === 'undefined' || !file || !file.type.startsWith('image/')) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate scale factor while maintaining aspect ratio
        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(file);
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return resolve(file);
            }

            const originalName = file.name.replace(/\.[^/.]+$/, '');
            const compressedFile = new File(
              [blob],
              `${originalName}.webp`,
              { type: 'image/webp', lastModified: Date.now() }
            );

            console.log(
              `[compressImageFile] Original: ${(file.size / 1024).toFixed(1)}KB -> Compressed: ${(compressedFile.size / 1024).toFixed(1)}KB`
            );

            resolve(compressedFile);
          },
          'image/webp',
          quality
        );
      };

      img.onerror = () => resolve(file);
    };

    reader.onerror = () => resolve(file);
  });
}
