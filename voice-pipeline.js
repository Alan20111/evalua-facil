import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const TTS_VOICE_ID = 'RyfjEHnKbtma4Srae2za'; // Juan Carlos - Deep and Calm Spanish Voice
const STS_VOICE_ID = 'GNGxFv49rftJ0o2WYj0G'; // clon de voz
const OUTPUT_DIR = './output';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function runTts(client, text) {
  console.log('Generando audio con Text-to-Speech (eleven_v3)...');
  const ttsStream = await client.textToSpeech.convert(TTS_VOICE_ID, {
    text,
    modelId: 'eleven_v3',
    seed: 42,
    voiceSettings: {
      stability: 0.7,
      similarityBoost: 0.8,
    },
  });
  return streamToBuffer(ttsStream);
}

async function runSts(client, audioBuffer) {
  console.log('Aplicando Speech-to-Speech (voice changer)...');
  const stsStream = await client.speechToSpeech.convert(STS_VOICE_ID, {
    audio: new Blob([audioBuffer], { type: 'audio/mpeg' }),
    modelId: 'eleven_multilingual_sts_v2',
  });
  return streamToBuffer(stsStream);
}

function extractName(argv) {
  const idx = argv.indexOf('--name');
  if (idx === -1) {
    return { name: null, rest: argv };
  }
  const name = argv[idx + 1];
  const rest = [...argv.slice(0, idx), ...argv.slice(idx + 2)];
  return { name, rest };
}

function parseArgs(argv) {
  const { name, rest } = extractName(argv);

  if (rest[0] === '--preview') {
    const text = rest.slice(1).join(' ').trim();
    return { mode: 'preview', text, name };
  }
  if (rest[0] === '--finalize') {
    return { mode: 'finalize', previewPath: rest[1], name };
  }
  return { mode: 'full', text: rest.join(' ').trim(), name };
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Error: falta ELEVENLABS_API_KEY en el archivo .env');
    process.exit(1);
  }

  const { mode, text, previewPath, name } = parseArgs(process.argv.slice(2));
  const client = new ElevenLabsClient({ apiKey });

  try {
    ensureOutputDir();

    if (mode === 'preview') {
      if (!text) {
        console.error('Uso: node voice-pipeline.js --preview "texto..." [--name nombre]');
        process.exit(1);
      }
      const ttsAudio = await runTts(client, text);
      const outputPath = path.join(OUTPUT_DIR, `preview-${name || timestamp()}.mp3`);
      fs.writeFileSync(outputPath, ttsAudio);
      console.log(`Listo. Preview guardado en: ${outputPath}`);
      return;
    }

    if (mode === 'finalize') {
      if (!previewPath) {
        console.error('Uso: node voice-pipeline.js --finalize <ruta-del-preview.mp3> [--name nombre]');
        process.exit(1);
      }
      if (!fs.existsSync(previewPath)) {
        console.error(`Error: no se encontró el archivo de preview en ${previewPath}`);
        process.exit(1);
      }
      const previewAudio = fs.readFileSync(previewPath);
      const finalAudio = await runSts(client, previewAudio);
      const outputPath = path.join(OUTPUT_DIR, `final-${name || timestamp()}.mp3`);
      fs.writeFileSync(outputPath, finalAudio);
      console.log(`Listo. Audio final guardado en: ${outputPath}`);
      return;
    }

    // Modo por defecto: ambos pasos juntos
    if (!text) {
      console.error('Uso: node voice-pipeline.js "texto a convertir en audio [pause] con [emphasis] tags"');
      process.exit(1);
    }
    const ttsAudio = await runTts(client, text);
    const finalAudio = await runSts(client, ttsAudio);
    const outputPath = path.join(OUTPUT_DIR, `voice-${name || timestamp()}.mp3`);
    fs.writeFileSync(outputPath, finalAudio);
    console.log(`Listo. Audio guardado en: ${outputPath}`);
  } catch (err) {
    console.error('Error en el pipeline de voz:', err.message || err);
    process.exit(1);
  }
}

main();
