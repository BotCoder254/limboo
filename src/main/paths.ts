/**
 * Resolves paths to static assets bundled with the app (icons, etc.). Works in
 * both development (`app.getAppPath()` is the project root) and packaged builds
 * (assets live inside the asar archive under the same relative path).
 */
import { app } from 'electron';
import path from 'node:path';

export function assetPath(...segments: string[]): string {
  return path.join(app.getAppPath(), 'assets', ...segments);
}
