/**
 * Attachment validation — classification, name sanitizing, and content sniffing
 * for files entering the per-session staging area. Pure functions, no I/O except
 * the head-bytes sniff helpers (callers pass buffers).
 *
 * Security (CLAUDE.md §6): display names are reduced to a safe character set,
 * Windows reserved device names are refused, image extensions must match their
 * magic bytes, and executables/scripts/installers are flagged as elevated risk.
 * Attaching NEVER executes anything; archives are never extracted.
 */
import path from 'node:path';
import {
  ATTACHMENT_ARCHIVE_EXTENSIONS,
  ATTACHMENT_ELEVATED_EXTENSIONS,
  ATTACHMENT_LIMITS,
  FS_LIMITS,
} from '@shared/constants';
import type { AttachmentCategory, AttachmentRisk } from '@shared/types';

/** Thrown when an attachment is rejected for a security/validation reason. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

/** Windows reserved device names (case-insensitive, extension-independent). */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Reduce a user-supplied filename to a safe display/storage basename. */
export function sanitizeName(input: string): string {
  const base = path.basename(String(input));
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/, '')
    .trim()
    .slice(0, ATTACHMENT_LIMITS.nameMax);
  if (!cleaned || /^\.+$/.test(cleaned)) {
    throw new AttachmentError('Invalid file name.');
  }
  const stem = cleaned.includes('.') ? cleaned.slice(0, cleaned.indexOf('.')) : cleaned;
  if (RESERVED_NAMES.test(stem)) {
    throw new AttachmentError('Reserved file name.');
  }
  return cleaned;
}

/** Lower-cased extension without the dot ('' when none). */
export function extOf(name: string): string {
  const e = path.extname(name).toLowerCase();
  return e.startsWith('.') ? e.slice(1) : e;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'swift', 'm',
  'scala', 'lua', 'pl', 'r', 'dart', 'vue', 'svelte', 'astro', 'css', 'scss',
  'less', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
]);
const DOCUMENT_EXTS = new Set([
  'md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'rtf', 'odt', 'html', 'htm',
  'log', 'rst', 'adoc', 'tex', 'epub',
]);
const DATA_EXTS = new Set([
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'sql', 'ini',
  'env', 'lock', 'properties', 'plist', 'proto', 'graphql',
]);
const ARCHIVE_EXTS = new Set<string>(ATTACHMENT_ARCHIVE_EXTENSIONS);
const ELEVATED_EXTS = new Set<string>(ATTACHMENT_ELEVATED_EXTENSIONS);

/** Extension → coarse category (icons, gates, handling). */
export function classifyCategory(name: string): AttachmentCategory {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (CODE_EXTS.has(ext)) return 'code';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  if (DATA_EXTS.has(ext)) return 'data';
  return 'other';
}

/** Executables / scripts / installers are elevated risk (never executed). */
export function classifyRisk(name: string): AttachmentRisk {
  return ELEVATED_EXTS.has(extOf(name)) ? 'elevated' : 'safe';
}

/** Minimal extension → MIME map (display + agent manifest + vision gating). */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
};

/** Best-effort MIME for a filename (text/plain for code, octet-stream fallback). */
export function mimeFor(name: string, category: AttachmentCategory): string {
  const byExt = MIME_BY_EXT[extOf(name)];
  if (byExt) return byExt;
  if (category === 'code' || category === 'data' || category === 'document') return 'text/plain';
  return 'application/octet-stream';
}

/** Image media types the Messages API accepts as vision content blocks. */
export const VISION_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** NUL-byte sniff of the head of a buffer (same heuristic as the File Reader). */
export function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, FS_LIMITS.binarySniffBytes);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Verify the head bytes of a claimed raster image actually match its magic
 * number, so a renamed executable can never masquerade as a screenshot. SVG
 * (text) and less common formats are exempt — they are never vision-sent.
 */
export function imageMagicMatches(mime: string, head: Buffer): boolean {
  switch (mime) {
    case 'image/png':
      return head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    case 'image/jpeg':
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/gif':
      return head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp':
      return (
        head.length >= 12 &&
        head.subarray(0, 4).toString('latin1') === 'RIFF' &&
        head.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    default:
      return true;
  }
}
