import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

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
const model = process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001';
const imagesDir = '.note-artifacts/images';
fs.mkdirSync(imagesDir, { recursive: true });

const manifest = [];
const imageSections = sections
  .map((section, sectionIndex) => ({ section, sectionIndex }))
  .filter(({ section }) => Number(section.headingLevel || 2) === 2);

if (!imageSections.length) {
  console.error('final.json does not contain any level-2 sections for image generation');
  process.exit(1);
}

for (let imageIndex = 0; imageIndex < imageSections.length; imageIndex++) {
  const { section, sectionIndex } = imageSections[imageIndex];
  const filename = `section-${String(imageIndex + 1).padStart(2, '0')}.png`;
  const imagePath = path.join(imagesDir, filename);
  const prompt = [
    section.imagePrompt,
    '',
    `Article title: ${article.title}`,
    `Section heading: ${section.heading}`,
    'Must be suitable as an inline note.com article illustration.',
    'No visible text, no letters, no captions, no logos, no watermark-like text.',
  ].filter(Boolean).join('\n');

  console.log(`Generating image ${imageIndex + 1}/${imageSections.length}: ${section.heading}`);
  const response = await ai.models.generateImages({
    model,
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: '16:9',
      outputMimeType: 'image/png',
      imageSize: '1K',
      includeRaiReason: true,
    },
  });

  const generated = response.generatedImages?.[0];
  const imageBytes = generated?.image?.imageBytes;
  if (!imageBytes) {
    const reason = generated?.raiFilteredReason || 'unknown reason';
    throw new Error(`Image generation failed for section "${section.heading}": ${reason}`);
  }

  fs.writeFileSync(imagePath, Buffer.from(imageBytes, 'base64'));
  section.imagePath = imagePath;
  manifest.push({
    sectionIndex,
    heading: section.heading,
    imagePath,
    imageAlt: section.imageAlt || section.heading,
    prompt,
    enhancedPrompt: generated.enhancedPrompt || '',
  });
}

for (const section of sections) {
  if (Number(section.headingLevel || 2) !== 2) {
    section.imagePath = '';
  }
}

article.sections = sections;
article.body = sections.map(section => {
  const marks = '#'.repeat(Math.min(Math.max(Number(section.headingLevel || 2), 2), 3));
  return `${marks} ${section.heading}\n\n${section.body}`.trim();
}).join('\n\n');
article.draftBody = article.body;

fs.writeFileSync('.note-artifacts/final.json', JSON.stringify(article, null, 2));
fs.writeFileSync('.note-artifacts/image-manifest.json', JSON.stringify(manifest, null, 2));
