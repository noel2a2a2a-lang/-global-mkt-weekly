const fs = require('fs');
const path = require('path');

const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1kQ-InlQsnmiGcrZPNs64gXpnR9JHYHh0';
const SITE_DIR = path.join(__dirname, 'docs');
const ARTICLES_DIR = path.join(SITE_DIR, 'articles');
const TEMPLATE_PATH = path.join(__dirname, 'site', 'article-template.html');
const INDEX_PATH = path.join(__dirname, 'site', 'index.html');

async function main() {
  const { default: fetch } = await import('node-fetch');
  const { marked } = await import('marked');

  console.log('🚀 Build started...');
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const listUrl = `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents&orderBy=name+desc&fields=files(id,name,modifiedTime,mimeType)&key=${process.env.GOOGLE_API_KEY}`;
  console.log('Fetching:', listUrl);

  const res = await fetch(listUrl);
  const data = await res.json();
  console.log('API response:', JSON.stringify(data));

  const files = (data.files || []).filter(f => f.name.endsWith('.md') || f.mimeType === 'text/markdown');
  console.log(`📂 Found ${files.length} markdown files`);

  const articles = [];

  for (const file of files) {
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${process.env.GOOGLE_API_KEY}`;
    const r = await fetch(downloadUrl);
    const mdContent = await r.text();

    const meta = parseFrontMatter(mdContent);
    const body = stripFrontMatter(mdContent);
    const slug = file.name.replace(/\.md$/, '').replace(/\s+/g, '-');
    const title = meta.title || extractFirstH1(body) || slug;
    const excerpt = extractExcerpt(body, 150);
    const date = meta.date || file.modifiedTime?.split('T')[0] || '';
    const week = meta.week || String(files.indexOf(file) + 1).padStart(2, '0');
    const tags = meta.tags ? meta.tags.replace(/[\[\]]/g, '').split(',').map(t => t.trim()) : [];

    const typeStr = (title + ' ' + tags.join(' ')).toLowerCase();
    const isUpdate = typeStr.includes('update') || typeStr.includes('アップデート') || typeStr.includes('ログ');
    const labelClass = isUpdate ? 'upd' : 'sig';
    const labelText  = isUpdate ? 'Update Log' : 'Future Signal';

    const htmlContent = marked.parse(body);
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const articleHtml = template
      .replace(/__ARTICLE_TITLE__/g, escapeHtml(title))
      .replace(/__ARTICLE_DATE__/g, date)
      .replace(/__ARTICLE_WEEK__/g, week)
      .replace(/__ARTICLE_LABEL_CLASS__/g, labelClass)
      .replace(/__ARTICLE_LABEL__/g, labelText)
      .replace(/__ARTICLE_TAGS__/g, tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('\n'))
      .replace('__ARTICLE_CONTENT__', htmlContent);

    fs.writeFileSync(path.join(ARTICLES_DIR, `${slug}.html`), articleHtml, 'utf-8');
    console.log(`✅ Generated: articles/${slug}.html`);
    articles.push({ slug, title, excerpt, date, week, tags });
  }

  const indexTemplate = fs.readFileSync(INDEX_PATH, 'utf-8');
  const indexHtml = indexTemplate.replace('__ARTICLES_DATA__', JSON.stringify(articles));
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), indexHtml, 'utf-8');
  console.log(`✅ Generated: index.html (${articles.length} articles)`);
  fs.copyFileSync(TEMPLATE_PATH, path.join(SITE_DIR, 'article-template.html'));
  console.log('🎉 Build complete!');
}

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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

main().catch(e => { console.error(e); process.exit(1); });
