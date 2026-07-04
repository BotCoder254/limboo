/**
 * Per-language file icons for the Files tree. Maps well-known basenames first,
 * then extensions, to a lucide icon + an EXISTING theme token class — no new
 * palette values (CLAUDE.md §4: token discipline; icon shape disambiguates,
 * color only groups). Unknown files fall back to the faint generic `File`.
 */
import {
  BookOpen,
  Box,
  Component,
  Container,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Gem,
  GitBranch,
  Globe,
  Hexagon,
  Link2,
  Package,
  Palette,
  Scale,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface FileIconSpec {
  icon: LucideIcon;
  /** A text color utility from the existing token palette. */
  className: string;
}

const DEFAULT: FileIconSpec = { icon: File, className: 'text-faint' };
const SYMLINK: FileIconSpec = { icon: Link2, className: 'text-faint' };

/** Exact (lowercased) basenames checked before the extension map. */
const BY_BASENAME: Record<string, FileIconSpec> = {
  'package.json': { icon: Package, className: 'text-danger' },
  'package-lock.json': { icon: FileLock, className: 'text-faint' },
  'yarn.lock': { icon: FileLock, className: 'text-faint' },
  'pnpm-lock.yaml': { icon: FileLock, className: 'text-faint' },
  'cargo.lock': { icon: FileLock, className: 'text-faint' },
  'limboo.json': { icon: FileCog, className: 'text-accent' },
  dockerfile: { icon: Container, className: 'text-accent' },
  'docker-compose.yml': { icon: Container, className: 'text-accent' },
  'docker-compose.yaml': { icon: Container, className: 'text-accent' },
  '.gitignore': { icon: GitBranch, className: 'text-warning' },
  '.gitattributes': { icon: GitBranch, className: 'text-warning' },
  '.gitmodules': { icon: GitBranch, className: 'text-warning' },
  '.env': { icon: FileKey, className: 'text-warning' },
  readme: { icon: BookOpen, className: 'text-accent' },
  'readme.md': { icon: BookOpen, className: 'text-accent' },
  'claude.md': { icon: BookOpen, className: 'text-accent' },
  license: { icon: Scale, className: 'text-muted' },
  makefile: { icon: Wrench, className: 'text-muted' },
  'cmakelists.txt': { icon: Wrench, className: 'text-muted' },
  gemfile: { icon: Gem, className: 'text-danger' },
  rakefile: { icon: Gem, className: 'text-danger' },
};

/** Lowercased extensions (no dot). */
const BY_EXT: Record<string, FileIconSpec> = {
  ts: { icon: FileCode, className: 'text-accent' },
  tsx: { icon: FileCode, className: 'text-accent' },
  mts: { icon: FileCode, className: 'text-accent' },
  cts: { icon: FileCode, className: 'text-accent' },
  js: { icon: FileCode, className: 'text-warning' },
  jsx: { icon: FileCode, className: 'text-warning' },
  mjs: { icon: FileCode, className: 'text-warning' },
  cjs: { icon: FileCode, className: 'text-warning' },
  json: { icon: FileJson, className: 'text-warning' },
  jsonc: { icon: FileJson, className: 'text-warning' },
  json5: { icon: FileJson, className: 'text-warning' },
  md: { icon: FileText, className: 'text-muted' },
  mdx: { icon: FileText, className: 'text-muted' },
  rst: { icon: FileText, className: 'text-muted' },
  txt: { icon: FileText, className: 'text-muted' },
  css: { icon: Palette, className: 'text-accent-fg' },
  scss: { icon: Palette, className: 'text-accent-fg' },
  sass: { icon: Palette, className: 'text-accent-fg' },
  less: { icon: Palette, className: 'text-accent-fg' },
  styl: { icon: Palette, className: 'text-accent-fg' },
  html: { icon: Globe, className: 'text-danger' },
  htm: { icon: Globe, className: 'text-danger' },
  vue: { icon: Component, className: 'text-success' },
  svelte: { icon: Component, className: 'text-success' },
  astro: { icon: Component, className: 'text-success' },
  py: { icon: FileCode, className: 'text-success' },
  pyi: { icon: FileCode, className: 'text-success' },
  go: { icon: FileCode, className: 'text-accent-fg' },
  rs: { icon: FileCode, className: 'text-warning' },
  java: { icon: FileCode, className: 'text-danger' },
  kt: { icon: FileCode, className: 'text-danger' },
  kts: { icon: FileCode, className: 'text-danger' },
  scala: { icon: FileCode, className: 'text-danger' },
  groovy: { icon: FileCode, className: 'text-danger' },
  c: { icon: FileCode, className: 'text-accent' },
  h: { icon: FileCode, className: 'text-accent' },
  cc: { icon: FileCode, className: 'text-accent' },
  cpp: { icon: FileCode, className: 'text-accent' },
  cxx: { icon: FileCode, className: 'text-accent' },
  hpp: { icon: FileCode, className: 'text-accent' },
  cs: { icon: FileCode, className: 'text-success' },
  rb: { icon: Gem, className: 'text-danger' },
  php: { icon: FileCode, className: 'text-accent-fg' },
  swift: { icon: FileCode, className: 'text-warning' },
  lua: { icon: FileCode, className: 'text-accent' },
  dart: { icon: FileCode, className: 'text-accent' },
  zig: { icon: FileCode, className: 'text-warning' },
  sh: { icon: FileTerminal, className: 'text-success' },
  bash: { icon: FileTerminal, className: 'text-success' },
  zsh: { icon: FileTerminal, className: 'text-success' },
  fish: { icon: FileTerminal, className: 'text-success' },
  ps1: { icon: FileTerminal, className: 'text-success' },
  psm1: { icon: FileTerminal, className: 'text-success' },
  bat: { icon: FileTerminal, className: 'text-success' },
  cmd: { icon: FileTerminal, className: 'text-success' },
  sql: { icon: Database, className: 'text-accent' },
  db: { icon: Database, className: 'text-accent' },
  sqlite: { icon: Database, className: 'text-accent' },
  yml: { icon: FileCog, className: 'text-muted' },
  yaml: { icon: FileCog, className: 'text-muted' },
  toml: { icon: FileCog, className: 'text-muted' },
  ini: { icon: FileCog, className: 'text-muted' },
  cfg: { icon: FileCog, className: 'text-muted' },
  conf: { icon: FileCog, className: 'text-muted' },
  properties: { icon: FileCog, className: 'text-muted' },
  graphql: { icon: Hexagon, className: 'text-accent-fg' },
  gql: { icon: Hexagon, className: 'text-accent-fg' },
  proto: { icon: Hexagon, className: 'text-accent-fg' },
  prisma: { icon: Hexagon, className: 'text-accent-fg' },
  xml: { icon: FileCode, className: 'text-muted' },
  plist: { icon: FileCode, className: 'text-muted' },
  svg: { icon: FileImage, className: 'text-warning' },
  png: { icon: FileImage, className: 'text-accent-fg' },
  jpg: { icon: FileImage, className: 'text-accent-fg' },
  jpeg: { icon: FileImage, className: 'text-accent-fg' },
  gif: { icon: FileImage, className: 'text-accent-fg' },
  webp: { icon: FileImage, className: 'text-accent-fg' },
  ico: { icon: FileImage, className: 'text-accent-fg' },
  bmp: { icon: FileImage, className: 'text-accent-fg' },
  avif: { icon: FileImage, className: 'text-accent-fg' },
  woff: { icon: FileType, className: 'text-muted' },
  woff2: { icon: FileType, className: 'text-muted' },
  ttf: { icon: FileType, className: 'text-muted' },
  otf: { icon: FileType, className: 'text-muted' },
  eot: { icon: FileType, className: 'text-muted' },
  mp3: { icon: FileAudio, className: 'text-accent-fg' },
  wav: { icon: FileAudio, className: 'text-accent-fg' },
  ogg: { icon: FileAudio, className: 'text-accent-fg' },
  flac: { icon: FileAudio, className: 'text-accent-fg' },
  mp4: { icon: FileVideo, className: 'text-accent-fg' },
  mov: { icon: FileVideo, className: 'text-accent-fg' },
  webm: { icon: FileVideo, className: 'text-accent-fg' },
  mkv: { icon: FileVideo, className: 'text-accent-fg' },
  avi: { icon: FileVideo, className: 'text-accent-fg' },
  zip: { icon: FileArchive, className: 'text-warning' },
  tar: { icon: FileArchive, className: 'text-warning' },
  gz: { icon: FileArchive, className: 'text-warning' },
  tgz: { icon: FileArchive, className: 'text-warning' },
  rar: { icon: FileArchive, className: 'text-warning' },
  '7z': { icon: FileArchive, className: 'text-warning' },
  bz2: { icon: FileArchive, className: 'text-warning' },
  xz: { icon: FileArchive, className: 'text-warning' },
  pdf: { icon: FileText, className: 'text-danger' },
  csv: { icon: FileSpreadsheet, className: 'text-success' },
  tsv: { icon: FileSpreadsheet, className: 'text-success' },
  xlsx: { icon: FileSpreadsheet, className: 'text-success' },
  wasm: { icon: Box, className: 'text-accent' },
  lock: { icon: FileLock, className: 'text-faint' },
};

/** Icon + color token class for a file entry (basename first, then extension). */
export function getFileIcon(name: string, isSymlink?: boolean): FileIconSpec {
  if (isSymlink) return SYMLINK;
  const lower = name.toLowerCase();

  const exact = BY_BASENAME[lower];
  if (exact) return exact;

  // Common prefixed/patterned config names.
  if (lower.startsWith('tsconfig')) return { icon: FileCog, className: 'text-accent' };
  if (lower.startsWith('dockerfile.')) return { icon: Container, className: 'text-accent' };
  if (lower.startsWith('.env.')) return { icon: FileKey, className: 'text-warning' };
  if (lower.startsWith('readme.')) return { icon: BookOpen, className: 'text-accent' };
  if (lower.startsWith('license') || lower.startsWith('licence')) {
    return { icon: Scale, className: 'text-muted' };
  }
  if (lower.startsWith('.eslintrc') || lower.startsWith('.prettierrc')) {
    return { icon: FileCog, className: 'text-muted' };
  }
  if (/\.config\.[^.]+$/.test(lower)) return { icon: FileCog, className: 'text-muted' };

  const dot = lower.lastIndexOf('.');
  if (dot < 0 || dot === lower.length - 1) return DEFAULT;
  return BY_EXT[lower.slice(dot + 1)] ?? DEFAULT;
}
