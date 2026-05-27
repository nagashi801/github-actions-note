export function extractJsonFlexible(raw) {
  const t = String(raw || '').trim().replace(/\u200B/g, '');
  try {
    return JSON.parse(t);
  } catch {}

  const fence = t.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {}
  }

  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(t.slice(first, last + 1));
    } catch {}
  }

  return null;
}

export function sanitizeTitle(value) {
  let s = String(value || '').trim();
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*$/, '').replace(/^```$/, '');
  s = s.replace(/^#+\s*/, '');
  s = stripMarkdownLinks(s);
  s = s.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').replace(/^`+|`+$/g, '');
  return s || 'タイトル（自動生成）';
}

export function uniqueTags(tags) {
  return Array.from(new Set((tags || []).map(String).map(s => s.trim()).filter(Boolean)));
}

export function cleanupArticleBody(text) {
  let s = String(text || '').replace(/\r\n/g, '\n').replace(/\u200B/g, '');

  for (let i = 0; i < 3; i++) {
    s = s.replace(/([\u3002\uff01\uff1f!?])\n{2,}([\u300d\u300f\u3011\uff09)\]])/g, '$1$2');
  }

  s = s
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      const label = trimmed.match(/^([^:\uff1a\n]{1,40})[:\uff1a]$/);
      if (label) return `### ${label[1].trim()}`;
      return trimmed;
    })
    .filter(Boolean)
    .join('\n\n');

  return normalizeOutputLabels(formatInlinePromptExamples(s.replace(/\n{3,}/g, '\n\n').trim()));
}

function formatInlinePromptExamples(text) {
  return String(text || '')
    .split('\n')
    .map(line => {
      const match = line.match(/^(\s*)((?:ChatGPT|Kling|動画生成AI|画像生成AI|改善後)?プロンプト\d*|Prompt\s*\d*)[:：]\s*(.{45,})$/i);
      if (!match) return line;

      const [, indent, label, content] = match;
      const parts = content
        .split(/(?<=[。.!！?？])\s*/)
        .map(part => part.trim())
        .filter(Boolean);
      if (parts.length < 2) return line;

      return [
        `${indent}${label}`,
        '',
        ...parts.map(part => `${indent}    ${part}`),
      ].join('\n');
    })
    .join('\n');
}

function normalizeOutputLabels(text) {
  return String(text || '')
    .replace(/---\s*出力開始\s*---\s*/g, '\n\n---出力結果---\n\n')
    .replace(/---\s*出力結果\s*---\s*(?=\S)/g, '---出力結果---\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitJapaneseSentences(text) {
  const split = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (
        /^(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/m.test(trimmed) ||
        trimmed.includes('\n- ') ||
        trimmed.includes('\n* ')
      ) {
        return trimmed;
      }
      return trimmed
        .replace(/([。！？])(?=(?:[「『（(【\[])?[^\s\n])/g, '$1\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    })
    .filter(Boolean)
    .join('\n\n');

  return cleanupArticleBody(split);
}

function stripMarkdownLinks(value) {
  return String(value || '').replace(/\[([^\]\n]{1,120})\]\((?:https?:\/\/|\/)[^)]+\)/g, '$1');
}

function stripHeadingMarkup(value) {
  let s = String(value || '').replace(/^#{1,6}\s*/, '').trim();
  s = stripMarkdownLinks(s);
  s = s.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
  return s;
}

function normalizeDemoAsset(asset, sectionIndex, assetIndex) {
  if (String(process.env.ENABLE_DEMO_ASSETS || 'false') !== 'true') {
    return null;
  }

  const raw = [
    asset?.label,
    asset?.caption,
    asset?.prompt,
    asset?.imagePrompt,
  ].map(value => String(value || '')).join(' ');
  if (/(動画|video|スクショ|screenshot|キャプチャ|作業画面|設定画面|タイムライン)/i.test(raw)) {
    return null;
  }

  const id = String(asset?.id || `s${sectionIndex + 1}_demo${assetIndex + 1}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    id,
    type: 'generated_image',
    label: String(asset?.label || `生成結果 ${assetIndex + 1}`).trim(),
    prompt: String(asset?.prompt || asset?.imagePrompt || '').trim(),
    caption: String(asset?.caption || asset?.imageAlt || asset?.label || '').trim(),
    imagePath: String(asset?.imagePath || '').trim(),
  };
}

function normalizeSection(section, index) {
  const heading = stripHeadingMarkup(section?.heading || section?.title || `見出し ${index + 1}`);
  const headingLevel = Number(section?.headingLevel || section?.level || 2);
  const level = Number.isFinite(headingLevel) ? Math.min(Math.max(headingLevel, 2), 3) : 2;
  let body = splitJapaneseSentences(section?.body || section?.content || '');
  const imagePrompt = String(section?.imagePrompt || section?.image_prompt || '').trim();
  const imageAlt = stripHeadingMarkup(section?.imageAlt || section?.image_alt || heading);
  const demoAssets = Array.isArray(section?.demoAssets)
    ? section.demoAssets.map((asset, assetIndex) => normalizeDemoAsset(asset, index, assetIndex)).filter(asset => asset?.id && asset.prompt)
    : [];
  const demoAssetIds = new Set(demoAssets.map(asset => asset.id));
  body = body.replace(/\[\[demo_image:([a-zA-Z0-9_-]+)\]\]/g, (marker, id) => demoAssetIds.has(id) ? marker : '');
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  return {
    heading,
    headingLevel: level,
    body,
    imagePrompt,
    imageAlt,
    imagePath: section?.imagePath || '',
    demoAssets,
  };
}

export function sectionsFromMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push(current);
      current = {
        heading: match[2].trim(),
        headingLevel: match[1].length,
        bodyLines: [],
        imagePrompt: '',
        imageAlt: match[2].trim(),
      };
      continue;
    }

    if (!current) {
      const content = line.trim();
      if (!content) continue;
      current = {
        heading: 'はじめに',
        headingLevel: 2,
        bodyLines: [line],
        imagePrompt: '',
        imageAlt: 'はじめに',
      };
      continue;
    }

    current.bodyLines.push(line);
  }

  if (current) sections.push(current);

  return sections.map((section, index) => normalizeSection({
    ...section,
    body: section.bodyLines.join('\n').trim(),
  }, index));
}

export function normalizeArticleShape(obj, fallback = {}) {
  const source = obj && typeof obj === 'object' ? obj : {};
  const title = sanitizeTitle(source.title || fallback.title || '');
  const draftBody = String(source.draftBody || source.body || fallback.draftBody || fallback.body || '').trim();
  const rawSections = Array.isArray(source.sections) ? source.sections : [];
  let sections = rawSections.map(normalizeSection).filter(section => section.heading);

  if (!sections.length && draftBody) {
    sections = sectionsFromMarkdown(draftBody);
  }

  if (!sections.length && fallback.researchReport) {
    sections = [{
      heading: title,
      headingLevel: 2,
      body: splitJapaneseSentences(fallback.researchReport),
      imagePrompt: '',
      imageAlt: title,
      imagePath: '',
    }];
  }

  const tags = uniqueTags(source.tags || fallback.tags || []);

  return {
    title,
    draftBody: sectionsToMarkdown(sections),
    body: sectionsToMarkdown(sections),
    sections,
    tags,
  };
}

export function sectionsToMarkdown(sections) {
  return (sections || [])
    .map(section => {
      const marks = '#'.repeat(Math.min(Math.max(Number(section.headingLevel || 2), 2), 3));
      return `${marks} ${stripHeadingMarkup(section.heading)}\n\n${splitJapaneseSentences(section.body)}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

export function ensureImagePrompts(article, theme = '') {
  return {
    ...article,
    sections: article.sections.map((section, index) => {
      const headingLevel = Math.min(Math.max(Number(section.headingLevel || 2), 2), 3);
      const prompt = String(section.imagePrompt || '').trim() || [
        'Japanese note.com article illustration.',
        `Article theme: ${theme || article.title}.`,
        `Section heading: ${section.heading}.`,
        'Create one vivid, emotionally resonant image that directly represents this section.',
        'Use a friendly AI/personified creative assistant motif when appropriate.',
        'No text, no letters, no logos, no UI screenshots.',
        'Warm, polished digital illustration, expressive composition, 16:9 landscape.',
      ].join(' ');

      return {
        ...section,
        headingLevel,
        imagePrompt: prompt,
        imageAlt: section.imageAlt || `${index + 1}. ${section.heading}`,
        imagePath: section.imagePath || '',
        demoAssets: Array.isArray(section.demoAssets)
          ? section.demoAssets.map((asset, assetIndex) => normalizeDemoAsset(asset, index, assetIndex)).filter(asset => asset?.id && asset.prompt)
          : [],
      };
    }),
  };
}
