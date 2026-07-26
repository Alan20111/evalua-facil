#!/usr/bin/env node

// Test pipeline: given a scene id/number, builds the prompt (reusing
// create-prompt.js), calls gpt-image-1 with Master_Character_v1.0.png as
// reference, and saves the result as Avatar/Output/Pose_NNN.png.
//
// Usage: node Avatar/generate-pose.js <scene id or number>

import fs from 'fs';
import path from 'path';
import {
  PROMPTS_DIR,
  loadCatalogs,
  resolveScene,
  resolveAction,
  buildPromptContent,
} from './create-prompt.js';
import { generateImageFromReference } from './generate-image.js';
import { config } from './config.js';

function nextPoseFilename(outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const existingNumbers = fs
    .readdirSync(outputDir)
    .map((file) => file.match(/^Pose_(\d+)\.png$/))
    .filter(Boolean)
    .map((match) => Number(match[1]));

  const next = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
  return `Pose_${String(next).padStart(3, '0')}.png`;
}

async function main() {
  const sceneChoice = process.argv[2];
  if (!sceneChoice) {
    console.error('Usage: node Avatar/generate-pose.js <scene id or number>');
    process.exit(1);
  }

  let template, actions, scenes;
  try {
    ({ template, actions, scenes } = loadCatalogs());
  } catch (err) {
    console.error(`Failed to load catalogs: ${err.message}`);
    process.exit(1);
  }

  const selectedScene = resolveScene(scenes, sceneChoice);
  if (!selectedScene) {
    console.error(`Unknown scene "${sceneChoice}".`);
    process.exit(1);
  }

  const selectedAction = resolveAction(actions, selectedScene.action);
  if (!selectedAction) {
    console.error(
      `Scene "${selectedScene.id}" references unknown action "${selectedScene.action}".`
    );
    process.exit(1);
  }

  console.log(`Scene: ${selectedScene.id} (${selectedScene.title})`);
  console.log(`Action: ${selectedAction.name}`);

  const promptContent = buildPromptContent(template, selectedAction, selectedScene);

  const promptPath = path.join(PROMPTS_DIR, `${selectedScene.id}.md`);
  fs.writeFileSync(promptPath, promptContent, 'utf8');
  console.log(`Prompt saved: ${promptPath}`);

  console.log(`Requesting image from ${config.model}...`);
  let imageBuffer;
  try {
    imageBuffer = await generateImageFromReference({ prompt: promptContent });
  } catch (err) {
    console.error(`Image generation failed: ${err.message}`);
    process.exit(1);
  }

  const filename = nextPoseFilename(config.outputDir);
  const outputPath = path.join(config.outputDir, filename);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(`Image saved: ${outputPath}`);
}

main();
