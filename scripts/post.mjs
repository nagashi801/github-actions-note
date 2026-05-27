import { chromium } from 'playwright';
import { marked } from 'marked';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STATE_PATH = process.env.STATE_PATH;
const START_URL = process.env.START_URL || 'https://editor.note.com/new';
const rawFinal = JSON.parse(fs.readFileSync('final.json', 'utf8'));
const rawTitle = process.env.TITLE || rawFinal.title || '';
const TAGS = process.env.TAGS || '';
const IS_PUBLIC = String(process.env.IS_PUBLIC || 'false') === 'true';
const browserLogs = [];
const networkIssues = [];

if (!fs.existsSync(STATE_PATH)) {
  console.error('storageState not found:', STATE_PATH);
  process.exit(1);
}

function sanitizeTitle(t) {
  let s = String(t || '').trim();
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*$/, '').replace(/^```$/, '');
  s = s.replace(/^#+\s*/, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').replace(/^`+|`+$/g, '');
  return s || '\u30bf\u30a4\u30c8\u30eb\uff08\u81ea\u52d5\u751f\u6210\uff09';
}

function normalizeMarkdown(md) {
  return String(md || '')
    .replace(/^\s*[\u2022\u30fb]\s?/gm, '- ')
    .replace(/\u200B/g, '')
    .trim();
}

function renderMarkdown(md) {
  return String(marked.parse(normalizeMarkdown(md), { gfm: true, breaks: false }) || '');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function renderSectionHtml(segment) {
  if (segment.html) return segment.html;
  const level = Math.min(Math.max(Number(segment.headingLevel || 2), 2), 3);
  const heading = `<h${level}>${escapeHtml(segment.heading || '')}</h${level}>`;
  return `${heading}\n${renderMarkdown(segment.body || '')}`;
}

function splitBodyByDemoMarkers(body) {
  const parts = [];
  const pattern = /\[\[demo_image:([a-zA-Z0-9_-]+)\]\]/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(String(body || '')))) {
    const before = String(body || '').slice(lastIndex, match.index).trim();
    if (before) parts.push({ type: 'markdown', markdown: before });
    parts.push({ type: 'demo_image', id: match[1] });
    lastIndex = pattern.lastIndex;
  }
  const rest = String(body || '').slice(lastIndex).trim();
  if (rest) parts.push({ type: 'markdown', markdown: rest });
  return parts.length ? parts : [{ type: 'markdown', markdown: String(body || '') }];
}

function articleSegments(article) {
  const sections = Array.isArray(article.sections) ? article.sections : [];
  if (!sections.length) {
    return [{ html: renderMarkdown(article.body || article.draftBody || ''), imagePath: '', imageAlt: '' }];
  }

  return sections.map(section => {
    const level = Math.min(Math.max(Number(section.headingLevel || 2), 2), 3);
    return {
      heading: section.heading || '',
      headingLevel: level,
      body: section.body || '',
      imagePath: section.imagePath || '',
      imageAlt: section.imageAlt || section.heading || '',
      demoAssets: Array.isArray(section.demoAssets) ? section.demoAssets : [],
    };
  });
}

async function focusEditorEnd(locator) {
  await locator.click();
  await locator.evaluate(el => {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

async function insertHTML(locator, html) {
  await focusEditorEnd(locator);
  await locator.evaluate((el, html) => {
    document.execCommand('insertHTML', false, `${html}<p><br></p>`);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertHTML', data: html }));
  }, html);
}

async function pasteHTML(page, context, locator, html, plain) {
  await insertHTML(locator, html);
  await page.waitForTimeout(300);
}

async function pasteImage(page, context, locator, imagePath, alt) {
  if (!imagePath) return;
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found for section "${alt}": ${imagePath}`);
  }

  await focusEditorEnd(locator);
  const data = fs.readFileSync(imagePath).toString('base64');
  const origin = new URL(START_URL).origin;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.evaluate(async ({ data }) => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const item = new ClipboardItem({
      'image/png': new Blob([bytes], { type: 'image/png' }),
    });
    await navigator.clipboard.write([item]);
  }, { data });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('ArrowRight').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(500);
}

async function writeDebugSnapshot(page, debugHtml) {
  const summary = await page.evaluate(() => {
    const pick = selector => Array.from(document.querySelectorAll(selector)).slice(0, 20).map((el, index) => ({
      index,
      tag: el.tagName,
      id: el.id || '',
      className: String(el.className || ''),
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      dataPlaceholder: el.getAttribute('data-placeholder') || '',
      contenteditable: el.getAttribute('contenteditable') || '',
      text: (el.innerText || el.textContent || '').trim().slice(0, 120),
    }));
    return {
      url: location.href,
      title: document.title,
      h1: pick('h1'),
      textarea: pick('textarea'),
      input: pick('input'),
      contenteditable: pick('[contenteditable]'),
      buttons: pick('button'),
      images: pick('img'),
      bodyText: (document.body?.innerText || '').trim().slice(0, 3000),
    };
  });
  summary.browserLogs = browserLogs.slice(-100);
  summary.networkIssues = networkIssues.slice(-100);
  fs.writeFileSync(debugHtml, [
    '<!doctype html><meta charset="utf-8">',
    '<h1>note editor debug</h1>',
    `<pre>${JSON.stringify(summary, null, 2).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`,
    '<hr>',
    await page.content(),
  ].join('\n'));
  console.log('DEBUG_HTML=' + debugHtml);
  console.log('EDITOR_DEBUG_SUMMARY=' + JSON.stringify(summary));
}

async function fillEditorTitle(page, title, debugHtml) {
  const candidates = [
    'h1[contenteditable="true"]',
    'h1[contenteditable]',
    '[data-testid*="title"]',
    '[class*="title"][contenteditable="true"]',
    'textarea[placeholder*="\u30bf\u30a4\u30c8\u30eb"]',
    'textarea[aria-label*="\u30bf\u30a4\u30c8\u30eb"]',
    'input[placeholder*="\u30bf\u30a4\u30c8\u30eb"]',
    'textarea',
    '[contenteditable="true"][data-placeholder*="\u30bf\u30a4\u30c8\u30eb"]',
    '[contenteditable="true"][aria-label*="\u30bf\u30a4\u30c8\u30eb"]',
  ];
  const titleBox = page.locator(candidates.join(', ')).first();
  try {
    await titleBox.waitFor({ state: 'visible', timeout: 30000 });
  } catch (error) {
    await writeDebugSnapshot(page, debugHtml);
    throw error;
  }
  try {
    await titleBox.fill(title);
  } catch {
    await titleBox.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(title);
  }
}

async function findBodyBox(page) {
  const boxes = page
    .locator('.ProseMirror[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]')
    .filter({ hasNot: page.locator('h1') });
  await boxes.first().waitFor({ state: 'visible', timeout: 30000 });
  return boxes.first();
}

async function waitForEditorHydration(page, debugHtml, screenshot) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.waitForFunction(() => {
        const selectors = [
          'h1[contenteditable]',
          'textarea',
          'input',
          '[contenteditable]',
          'button',
          '.ProseMirror',
        ];
        return selectors.some(selector => document.querySelector(selector));
      }, { timeout: 45000 });
      return;
    } catch {
      console.warn(`Editor did not hydrate yet; attempt ${attempt}/4`);
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      if (attempt < 4) {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      }
    }
  }
  await writeDebugSnapshot(page, debugHtml);
  throw new Error('note editor stayed on a loading/blank screen. See note-editor-debug artifact for console/network details.');
}

const title = sanitizeTitle(rawTitle);
const segments = articleSegments(rawFinal);
const ssDir = process.env.NOTE_DEBUG_DIR || path.join(os.tmpdir(), 'note-screenshots');
fs.mkdirSync(ssDir, { recursive: true });
const screenshot = path.join(ssDir, 'note-post.png');
const debugHtml = path.join(ssDir, 'note-editor-debug.html');

let browser, context, page;
try {
  browser = await chromium.launch({ headless: true, args: ['--lang=ja-JP', '--disable-blink-features=AutomationControlled'] });
  context = await browser.newContext({
    storageState: STATE_PATH,
    locale: 'ja-JP',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1365, height: 768 },
  });
  page = await context.newPage();
  page.on('console', msg => browserLogs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', error => browserLogs.push({ type: 'pageerror', text: error.message || String(error) }));
  page.on('requestfailed', request => networkIssues.push({
    type: 'requestfailed',
    url: request.url(),
    method: request.method(),
    failure: request.failure()?.errorText || '',
  }));
  page.on('response', response => {
    if (response.status() >= 400) {
      networkIssues.push({ type: 'response', status: response.status(), url: response.url() });
    }
  });
  page.setDefaultTimeout(180000);
  await page.goto('https://note.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  console.log('CURRENT_URL=' + page.url());
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log('SCREENSHOT=' + screenshot);
  if (!/editor\.note\.com/.test(page.url())) {
    throw new Error(`Not on note editor after navigation. Current URL: ${page.url()}. NOTE_STORAGE_STATE_JSON may be expired or invalid.`);
  }
  await waitForEditorHydration(page, debugHtml, screenshot);

  await fillEditorTitle(page, title, debugHtml);

  const bodyBox = await findBodyBox(page);
  await bodyBox.waitFor({ state: 'visible' });
  const initialImages = await page.locator('img').count().catch(() => 0);
  for (const segment of segments) {
    if (segment.html) {
      await pasteHTML(page, context, bodyBox, segment.html, '');
      continue;
    }
    const level = Math.min(Math.max(Number(segment.headingLevel || 2), 2), 3);
    await pasteHTML(page, context, bodyBox, `<h${level}>${escapeHtml(segment.heading || '')}</h${level}>`, segment.heading || '');
    const demoAssetMap = new Map((segment.demoAssets || []).map(asset => [asset.id, asset]));
    const insertedDemoIds = new Set();
    for (const part of splitBodyByDemoMarkers(segment.body || '')) {
      if (part.type === 'markdown') {
        await pasteHTML(page, context, bodyBox, renderMarkdown(part.markdown), part.markdown);
      } else if (part.type === 'demo_image') {
        const asset = demoAssetMap.get(part.id);
        if (!asset) {
          console.warn(`Demo image marker has no matching asset: ${part.id}`);
          continue;
        }
        await pasteImage(page, context, bodyBox, asset.imagePath, asset.caption || asset.label || part.id);
        insertedDemoIds.add(asset.id);
        if (asset.caption) {
          await pasteHTML(page, context, bodyBox, `<p><em>${escapeHtml(asset.caption)}</em></p>`, asset.caption);
        }
      }
    }
    for (const asset of segment.demoAssets || []) {
      if (!asset.imagePath || insertedDemoIds.has(asset.id)) continue;
      console.warn(`Demo image asset was not referenced by a marker; appending at section end: ${asset.id}`);
      await pasteImage(page, context, bodyBox, asset.imagePath, asset.caption || asset.label || asset.id);
      if (asset.caption) {
        await pasteHTML(page, context, bodyBox, `<p><em>${escapeHtml(asset.caption)}</em></p>`, asset.caption);
      }
    }
    await pasteImage(page, context, bodyBox, segment.imagePath, segment.imageAlt);
  }

  await page.waitForFunction(() => {
    const el = document.querySelector('div[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"], div[contenteditable="true"]');
    return (el?.innerText || el?.textContent || '').trim().length > 0;
  });

  const expectedImages = segments.filter(segment => segment.imagePath).length
    + segments.reduce((count, segment) => count + (segment.demoAssets || []).filter(asset => asset.imagePath).length, 0);
  if (expectedImages) {
    await page.waitForFunction(
      ({ initialImages, expectedImages }) => document.querySelectorAll('img').length >= initialImages + expectedImages,
      { initialImages, expectedImages },
      { timeout: 60000 },
    ).catch(() => {});
    const actualImages = await page.locator('img').count().catch(() => 0);
    const insertedImages = actualImages - initialImages;
    console.log(`EXPECTED_INLINE_IMAGES=${expectedImages}`);
    console.log(`DETECTED_PAGE_IMAGES=${actualImages}`);
    console.log(`DETECTED_INSERTED_IMAGES=${insertedImages}`);
    if (insertedImages < expectedImages) {
      await writeDebugSnapshot(page, debugHtml);
      throw new Error(`Expected ${expectedImages} inserted images in the editor, but detected ${insertedImages}.`);
    }
  }

  const rawMarkdownHeadings = await page.evaluate(() => {
    const el = document.querySelector('div[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"], div[contenteditable="true"]');
    return (el?.innerText || el?.textContent || '').split('\n').filter(line => /^#{2,}\s/.test(line.trim())).slice(0, 5);
  });
  if (rawMarkdownHeadings.length) {
    await writeDebugSnapshot(page, debugHtml);
    throw new Error(`Raw Markdown headings were inserted instead of rich headings: ${rawMarkdownHeadings.join(' / ')}`);
  }

  if (!IS_PUBLIC) {
    const saveBtn = page.locator('button:has-text("\u4e0b\u66f8\u304d\u4fdd\u5b58"), [aria-label*="\u4e0b\u66f8\u304d\u4fdd\u5b58"]').first();
    await saveBtn.waitFor({ state: 'visible' });
    for (let i = 0; i < 30 && !(await saveBtn.isEnabled()); i++) {
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log('SCREENSHOT=' + screenshot);
    if (!(await saveBtn.isEnabled())) {
      throw new Error('Draft save button is visible but still disabled after inserting title, body, and images.');
    }
    await Promise.all([
      Promise.race([
        page.waitForURL(url => !String(url).endsWith('/new'), { timeout: 15000 }).catch(() => null),
        page.locator('text=\u4fdd\u5b58\u3057\u307e\u3057\u305f').waitFor({ timeout: 15000 }).catch(() => null),
      ]),
      saveBtn.click(),
    ]);
    const saved = !page.url().endsWith('/new') || await page.locator('text=\u4fdd\u5b58\u3057\u307e\u3057\u305f').count().catch(() => 0);
    await page.screenshot({ path: screenshot, fullPage: true });
    if (!saved) {
      console.log('DRAFT_URL=' + page.url());
      throw new Error('Draft save click completed, but no saved confirmation or draft URL was detected.');
    }
    console.log('DRAFT_URL=' + page.url());
    console.log('SCREENSHOT=' + screenshot);
  } else {
    const proceed = page.locator('button:has-text("\u516c\u958b\u306b\u9032\u3080")').first();
    await proceed.waitFor({ state: 'visible' });
    await proceed.click({ force: true });

    await Promise.race([
      page.waitForURL(/\/publish/i).catch(() => {}),
      page.locator('button:has-text("\u6295\u7a3f\u3059\u308b")').first().waitFor({ state: 'visible' }).catch(() => {}),
    ]);

    const tags = TAGS.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (tags.length) {
      let tagInput = page.locator('input[placeholder*="\u30cf\u30c3\u30b7\u30e5\u30bf\u30b0"]');
      if (!(await tagInput.count())) tagInput = page.locator('input[role="combobox"]').first();
      await tagInput.waitFor({ state: 'visible' });
      for (const t of tags) {
        await tagInput.click();
        await tagInput.fill(t);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(120);
      }
    }

    const publishBtn = page.locator('button:has-text("\u6295\u7a3f\u3059\u308b")').first();
    await publishBtn.waitFor({ state: 'visible' });
    await publishBtn.click({ force: true });
    await Promise.race([
      page.waitForURL(u => !/\/publish/i.test(String(u)), { timeout: 20000 }).catch(() => {}),
      page.locator('text=\u6295\u7a3f\u3057\u307e\u3057\u305f').first().waitFor({ timeout: 8000 }).catch(() => {}),
      page.waitForTimeout(5000),
    ]);

    await page.screenshot({ path: screenshot, fullPage: true });
    console.log('PUBLISHED_URL=' + page.url());
    console.log('SCREENSHOT=' + screenshot);
  }
} finally {
  try { await page?.close(); } catch {}
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
}
