import { clipboardHasImage, readClipboardImage } from "./clipboardImage.js";

/**
 * Check whether the clipboard currently holds a supported image. This is the
 * cheap status probe used by the composer; the paste path calls
 * getClipboardImage directly so it also works when only the native X11 helper
 * is available.
 */
export async function checkClipboardForImage(): Promise<boolean> {
  return clipboardHasImage();
}

/** The raw clipboard image bytes, or null when there is no readable image. */
export async function getClipboardImage(): Promise<Buffer | null> {
  const image = await readClipboardImage();
  return image?.bytes ?? null;
}
