// glob.js — hand-rolled glob expansion (we said zero dependencies, and we
// meant it). Supports: * (within a segment), ** (across segments), ? (single
// char), {a,b} alternation, and literal paths.

'use strict';

import fs from 'node:fs';
import path from 'node:path';

export function hasMagic(p) {
  return /[*?{]/.test(p);
}

function escapeRe(s) {
  return s.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

function segmentToRe(seg) {
  let out = '';
  let i = 0;
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === '*') {
      out += '[^/\\\\]*';
      i++;
    } else if (ch === '?') {
      out += '[^/\\\\]';
      i++;
    } else if (ch === '{') {
      const end = seg.indexOf('}', i);
      if (end < 0) { out += escapeRe(ch); i++; continue; }
      const alts = seg.slice(i + 1, end).split(',');
      out += `(?:${alts.map(escapeRe).join('|')})`;
      i = end + 1;
    } else {
      out += escapeRe(ch);
      i++;
    }
  }
  return out;
}

/**
 * Match a normalized posix-style relative path against a pattern of
 * "/"-separated segments. Windows separators are normalized before calling.
 */
export function matchPattern(pattern, relPath) {
  const patSegs = pattern.split('/');
  const pathSegs = relPath.split('/');
  return matchSegs(patSegs, 0, pathSegs, 0);
}

function matchSegs(pat, pi, segs, si) {
  if (pi === pat.length) return si === segs.length;
  const p = pat[pi];
  if (p === '**') {
    // zero or more segments
    for (let k = si; k <= segs.length; k++) {
      if (matchSegs(pat, pi + 1, segs, k)) return true;
    }
    return false;
  }
  if (si >= segs.length) return false;
  const re = new RegExp(`^${segmentToRe(p)}$`, 'i');
  if (!re.test(segs[si])) return false;
  return matchSegs(pat, pi + 1, segs, si + 1);
}

function walk(dir, base = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Expand a glob pattern (or literal path) relative to `cwd`, returning
 * absolute paths of existing files, sorted.
 */
export function expandGlob(pattern, cwd = process.cwd()) {
  const abs = path.resolve(cwd, pattern);
  if (!hasMagic(pattern)) {
    return fs.existsSync(abs) && fs.statSync(abs).isFile() ? [abs] : [];
  }
  const rel = path.relative(cwd, abs).split(path.sep).join('/');
  const all = walk(cwd);
  return all
    .filter((p) => matchPattern(rel, p))
    .map((p) => path.resolve(cwd, p))
    .sort();
}
