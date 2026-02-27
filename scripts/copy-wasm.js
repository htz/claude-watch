#!/usr/bin/env node
'use strict';

/**
 * postinstall スクリプト: vendor/ から tree-sitter-bash.wasm を
 * web-tree-sitter ディレクトリにコピーする。
 * permission-hook.js が require('web-tree-sitter') と同じディレクトリから
 * WASM ファイルを読み込めるようにするため。
 *
 * WASM ファイルは tree-sitter-bash v0.25.1 の公式リリースから取得 (ABI 15)。
 * https://github.com/tree-sitter/tree-sitter-bash/releases/tag/v0.25.1
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'vendor', 'tree-sitter-bash.wasm');
const destDir = path.join(__dirname, '..', 'node_modules', 'web-tree-sitter');
const dest = path.join(destDir, 'tree-sitter-bash.wasm');

try {
  if (!fs.existsSync(src)) {
    console.log('[copy-wasm] vendor/tree-sitter-bash.wasm not found, skipping');
    process.exit(0);
  }
  if (!fs.existsSync(destDir)) {
    console.log('[copy-wasm] web-tree-sitter not installed, skipping');
    process.exit(0);
  }
  fs.copyFileSync(src, dest);
  console.log('[copy-wasm] tree-sitter-bash.wasm → web-tree-sitter/');
} catch (err) {
  console.warn('[copy-wasm] Warning:', err.message);
  process.exit(0);
}
