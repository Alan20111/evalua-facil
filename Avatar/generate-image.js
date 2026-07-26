import fs from 'fs';
import { config } from './config.js';

const IMAGES_EDIT_URL = 'https://api.openai.com/v1/images/edits';

/**
 * Calls OpenAI's images.edit endpoint with a reference image + prompt and
 * returns the generated image as a Buffer.
 */
export async function generateImageFromReference({
  prompt,
  referenceImagePath = config.referenceImagePath,
  model = config.model,
  size = config.size,
}) {
  if (!config.apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Copy Avatar/.env.example to Avatar/.env and add your key.'
    );
  }
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt text is required to generate an image.');
  }
  if (!fs.existsSync(referenceImagePath)) {
    throw new Error(`Reference image not found: ${referenceImagePath}`);
  }

  const imageBuffer = fs.readFileSync(referenceImagePath);
  const imageBlob = new Blob([imageBuffer], { type: 'image/png' });

  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('image', imageBlob, 'reference.png');

  let response;
  try {
    response = await fetch(IMAGES_EDIT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new Error(`Network error calling OpenAI API: ${err.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI API response did not include image data.');
  }

  return Buffer.from(b64, 'base64');
}
