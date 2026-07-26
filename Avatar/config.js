import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const DEFAULT_REFERENCE_IMAGE = path.join(__dirname, 'Master Character v1.0.png');
const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'Output');

export const config = {
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  size: process.env.OPENAI_IMAGE_SIZE || '1024x1536',
  referenceImagePath: process.env.OPENAI_REFERENCE_IMAGE || DEFAULT_REFERENCE_IMAGE,
  outputDir: process.env.OPENAI_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
};
