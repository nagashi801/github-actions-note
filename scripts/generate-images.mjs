import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { isCodeOrManualMediaSection } from './article-utils.mjs';
import { withGeminiRetry } from './gemini-utils.mjs';

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.error('GEMINI_API_KEY secret is not set');
  process.exit(1);
}

const article = JSON.parse(fs.readFileSync('.note-artifacts/final.json', 'utf8'));
const sections = Array.isArray(article.sections) ? article.sections : [];
if (!sections.length) {
  console.error('final.json does not contain sections');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const model = process.env.IMAGEN_MODEL || 'imagen-4.0-fast-generate-001';
const canSetImageSize = !/fast/i.test(model);
const imagesDir = '.note-artifacts/images';
fs.mkdirSync(imagesDir, { recursive: true });

const manifest = [];
const imageSections = sections
  .map((section, sectionIndex) => ({ section, sectionIndex }))
  .filter(({ section }) => [2, 3].includes(Number(section.headingLevel || 2)) && String(section.imagePrompt || '').trim() && !isCodeOrManualMediaSection(section));
const demoImageTasks = sections.flatMap((section, sectionIndex) => (
  Array.isArray(section.demoAssets) ? section.demoAssets : []
).map((asset, assetIndex) => ({ section, sectionIndex, asset, assetIndex })))
  .filter(({ asset }) => asset.type === 'generated_image' && asset.prompt);

if (!imageSections.length && !demoImageTasks.length) {
  console.log('No image prompts found; skipping image generation.');
  fs.writeFileSync('.note-artifacts/final.json', JSON.stringify(article, null, 2));
  fs.writeFileSync('.note-artifacts/image-manifest.json', JSON.stringify(manifest, null, 2));
  process.exit(0);
}

async function generatePng(prompt, label) {
  console.log(`Generating image: ${label}`);
  const config = {
    numberOfImages: 1,
    aspectRatio: '16:9',
    outputMimeType: 'image/png',
    includeRaiReason: true,
  };
  if (canSetImageSize) {
    config.imageSize = '1K';
  }

  const response = await withGeminiRetry(`Imagen generateImages: ${label}`, () => ai.models.generateImages({
    model,
    prompt,
    config,
  }));

  const generated = response.generatedImages?.[0];
  const imageBytes = generated?.image?.imageBytes;
  if (!imageBytes) {
    const reason = generated?.raiFilteredReason || 'unknown reason';
    throw new Error(`Image generation failed for "${label}": ${reason}`);
  }

  return {
    buffer: Buffer.from(imageBytes, 'base64'),
    enhancedPrompt: generated.enhancedPrompt || '',
  };
}

function removeJapaneseLines(value) {
  return String(value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/[\u3040-\u30ff\u3400-\u9fff]/.test(line))
    .join('\n')
    .trim();
}

function sectionImagePrompt(section) {
  const base = removeJapaneseLines(section.imagePrompt);
  return [
    base || 'Warm polished editorial illustration for an online creator tutorial. A creator planning a short video workflow with abstract AI assistance, storyboards, simple icons, waveforms, and soft studio lighting.',
    '',
    'Create a visually appealing atmospheric image that improves the article layout and matches the mood of this text-heavy section.',
    'The image should support the article visually, not explain it with text.',
    'Avoid Japanese text completely.',
    'Do not include paragraphs, article headings, captions, chat messages, or detailed readable UI text.',
    'Short English labels such as AI, PDCA, STEP, simple numbers, simple icons, charts, waveforms, play buttons, and abstract UI panels are acceptable.',
    'Device screens may appear, but detailed text should be blurred, tiny, or unreadable.',
    'Do not create screenshots or realistic app interfaces.',
  ].filter(Boolean).join('\n');
}

function demoPrompt(asset) {
  const base = removeJapaneseLines(asset.prompt);
  return [
    base || 'Polished demo result image for an online creator tutorial, cinematic composition, no readable text.',
    '',
    'Create the actual-looking generated result that the article can show as a demo output.',
    'Avoid Japanese text completely unless the prompt explicitly asks for a document/mockup.',
    'Do not include paragraphs, article headings, captions, chat messages, or detailed readable UI text.',
    'Short English labels, simple icons, charts, waveforms, play buttons, and abstract UI panels are acceptable.',
  ].filter(Boolean).join('\n');
}

for (let imageIndex = 0; imageIndex < imageSections.length; imageIndex++) {
  const { section, sectionIndex } = imageSections[imageIndex];
  const filename = `section-${String(imageIndex + 1).padStart(2, '0')}.png`;
  const imagePath = path.join(imagesDir, filename);
  const prompt = sectionImagePrompt(section);

  const generated = await generatePng(prompt, `${imageIndex + 1}/${imageSections.length}: ${section.heading}`);
  fs.writeFileSync(imagePath, generated.buffer);
  section.imagePath = imagePath;
  manifest.push({
    type: 'section',
    sectionIndex,
    heading: section.heading,
    imagePath,
    imageAlt: section.imageAlt || section.heading,
    prompt,
    enhancedPrompt: generated.enhancedPrompt,
  });
}

for (let demoIndex = 0; demoIndex < demoImageTasks.length; demoIndex++) {
  const { section, sectionIndex, asset, assetIndex } = demoImageTasks[demoIndex];
  const filename = `demo-${String(demoIndex + 1).padStart(2, '0')}-${asset.id}.png`;
  const imagePath = path.join(imagesDir, filename);
  const prompt = demoPrompt(asset);

  const generated = await generatePng(prompt, `demo ${demoIndex + 1}/${demoImageTasks.length}: ${asset.label}`);
  fs.writeFileSync(imagePath, generated.buffer);
  asset.imagePath = imagePath;
  manifest.push({
    type: 'demo',
    sectionIndex,
    demoAssetIndex: assetIndex,
    demoAssetId: asset.id,
    heading: section.heading,
    label: asset.label,
    imagePath,
    imageAlt: asset.caption || asset.label,
    prompt,
    enhancedPrompt: generated.enhancedPrompt,
  });
}

article.sections = sections;
article.body = sections.map(section => {
  const marks = '#'.repeat(Math.min(Math.max(Number(section.headingLevel || 2), 2), 3));
  return `${marks} ${section.heading}\n\n${section.body}`.trim();
}).join('\n\n');
article.draftBody = article.body;

fs.writeFileSync('.note-artifacts/final.json', JSON.stringify(article, null, 2));
fs.writeFileSync('.note-artifacts/image-manifest.json', JSON.stringify(manifest, null, 2));
