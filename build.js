#!/usr/bin/env node
/**
 * build.js
 * Google Drive の .md ファイルを取得して HTML 記事ページを生成し、
 * index.html の記事一覧を更新するビルドスクリプト。
 *
 * 依存: node-fetch, marked
 * インストール: npm install
 */

const fs = require('fs');
const path = require('path');

// ── 設定 ──────────────────────────────────────────────
// Google Drive フォルダID（URLの末尾の長い文字列）
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1kQ-InlQsnmiGcrZPNs64gXpnR9JHYHh0';
const SITE_DIR = path.join(__dirname, 'docs');        // GitHub Pages は docs/ を公開
const ARTICLES_DIR = path.join(SITE_DIR, 'articles');
const TEMPLATE_PATH = path.join(__dirname, 'site', 'article-template.html');
const INDEX_PATH = path.join(__dirname, 'site', 'index.html');
// ───────────────────────────────────────────────────────

async function main() {
  // 動的インポート（ESM 対応）
  const { default: fetch } = await import('node-fetch');
  const { marked } = await import('marked');

  console.log('🚀 Build started...');

  // 出力ディレクトリ準備
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  // 1. Google Drive API でファイル一覧取得（公開フォルダ）
  const listUrl = `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+mimeType+'text/plain'&orderBy=name+desc&fields=files(id,name,modifiedTime)&key=${process.env.GOOGLE_API_KEY}`;
  
  let files = [];
  try {
    const res = await fetch(listUrl);
    const data = await res.json();
    files = (data.files || []).filter(f => f.name.endsWith('.md'));
    console.log(`📂 Found ${files.length} markdown files`);
  } catch (e) {
    console.error('❌ Failed to fetch file list:', e.message);
    process.exit(1);
  }

  // 2. 各ファイルの内容を取得してHTML生成
  const articles = [];

  for (const file of files) {
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${process.env.GOOGLE_API_KEY}`;
    
    try {
      const res = await fetch(downloadUrl);
      const mdContent = await res.text();

      // メタデータ抽出（Front Matter 形式: --- key: value ---）
      const meta = parseFrontMatter(mdContent);
      const body = stripFrontMatter(mdContent);

      // slug 生成（ファイル名から拡張子を除去）
      const slug = file.name.replace(/\.md$/, '').replace(/\s+/g, '-');

      // タイトル取得（Front Matter > 最初の H1 > ファイル名）
      const title = meta.title || extractFirstH1(body) || slug;

      // 抜粋（最初の段落テキスト、150文字）
      const excerpt = extractExcerpt(body, 150);

      // 日付
      const date = meta.date || file.modifiedTime?.split('T')[0] || '';

      // 週番号
      const week = meta.week || String(files.indexOf(file) + 1).padStart(2, '0');

      // タグ
      const tags = meta.tags ? meta.tags.split(',').map(t => t.trim()) : [];

      // HTML 変換
      const htmlContent = marked.parse(body);

      // 記事ページ生成
      const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
      const articleHtml = template
        .replace(/__ARTICLE_TITLE__/g, escapeHtml(title))
        .replace(/__ARTICLE_DATE__/g, date)
        .replace(/__ARTICLE_WEEK__/g, week)
        .replace(/__ARTICLE_TAGS__/g, tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('\n'))
        .replace('__ARTICLE_CONTENT__', htmlContent);

      fs.writeFileSync(path.join(ARTICLES_DIR, `${slug}.html`), articleHtml, 'utf-8');
      console.log(`✅ Generated: articles/${slug}.html`);

      articles.push({ slug, title, excerpt, date, week, tags });

    } catch (e) {
      console.error(`❌ Failed to process ${file.name}:`, e.message);
    }
  }

  // 3. index.html の __ARTICLES_DATA__ を実データで置き換え
  const indexTemplate = fs.readFileSync(INDEX_PATH, 'utf-8');
  const indexHtml = indexTemplate.replace(
    '__ARTICLES_DATA__',
    JSON.stringify(articles)
  );
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), indexHtml, 'utf-8');
  console.log(`✅ Generated: index.html (${articles.length} articles)`);

  // article-template.html も docs/ にコピー（念のため）
  fs.copyFileSync(TEMPLATE_PATH, path.join(SITE_DIR, 'article-template.html'));

  console.log('🎉 Build complete!');
}

// ── ユーティリティ関数 ──────────────────────────────

function parseFrontMatter(md) {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  match[1].split('\n').forEach(line => {
    const [key, ...vals] = line.split(':');
    if (key) meta[key.trim()] = vals.join(':').trim();
  });
  return meta;
}

function stripFrontMatter(md) {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
}

function extractFirstH1(md) {
  const match = md.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

function extractExcerpt(md, maxLen) {
  // Markdown記法を除去して純テキスト化
  const text = md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main().catch(e => { console.error(e); process.exit(1); });
