#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEMPLATE_PATH = path.join(__dirname, 'Prompts', 'template.md');
export const PROMPTS_DIR = path.join(__dirname, 'Prompts');
export const ACTIONS_PATH = path.join(__dirname, 'actions.json');
export const SCENES_PATH = path.join(__dirname, 'scenes.json');

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

// When stdin is piped (non-TTY), chaining rl.question() calls can drop
// answers on some platforms because all input arrives before the first
// question is asked. Read every line upfront in that case instead.
function makePiplinedAsk() {
  const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
  let i = 0;
  return (question) => {
    process.stdout.write(question);
    if (i >= lines.length) {
      console.error('\nRan out of piped input before all prompts were answered.');
      process.exit(1);
    }
    const line = lines[i];
    i += 1;
    process.stdout.write(`${line}\n`);
    return Promise.resolve(line);
  };
}

export function loadCatalogs() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  }
  if (!fs.existsSync(ACTIONS_PATH)) {
    throw new Error(`Actions catalog not found: ${ACTIONS_PATH}`);
  }
  if (!fs.existsSync(SCENES_PATH)) {
    throw new Error(`Scenes catalog not found: ${SCENES_PATH}`);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const { actions } = JSON.parse(fs.readFileSync(ACTIONS_PATH, 'utf8'));
  const { scenes } = JSON.parse(fs.readFileSync(SCENES_PATH, 'utf8'));

  return { template, actions, scenes };
}

export function resolveScene(scenes, choice) {
  const trimmed = String(choice).trim();
  const byNumber = scenes[Number(trimmed) - 1];
  const byId = scenes.find((scene) => scene.id === trimmed);
  return byNumber || byId || null;
}

export function resolveAction(actions, actionName) {
  return actions.find((action) => action.name === actionName) || null;
}

export function buildPromptContent(template, action, scene) {
  const pose = `${action.pose}\n\n${scene.description}`;
  const { expression, props } = action;

  return template
    .replace(/\{\{POSE\}\}/g, pose)
    .replace(/\{\{EXPRESSION\}\}/g, expression)
    .replace(/\{\{PROPS\}\}/g, props);
}

async function main() {
  let template, actions, scenes;
  try {
    ({ template, actions, scenes } = loadCatalogs());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let rl = null;
  let ask_;
  if (process.stdin.isTTY) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    ask_ = (question) => ask(rl, question);
  } else {
    ask_ = makePiplinedAsk();
  }

  console.log('Available scenes:');
  scenes.forEach((scene, index) => {
    console.log(`  ${index + 1}. ${scene.id} - ${scene.title}`);
  });

  let selectedScene = null;
  while (!selectedScene) {
    const choice = (await ask_('Choose a scene (id or number): ')).trim();
    selectedScene = resolveScene(scenes, choice);
    if (!selectedScene) {
      console.log(`Unknown scene "${choice}". Please try again.`);
    }
  }

  const selectedAction = resolveAction(actions, selectedScene.action);
  if (!selectedAction) {
    console.error(
      `Scene "${selectedScene.id}" references unknown action "${selectedScene.action}".`
    );
    if (rl) rl.close();
    process.exit(1);
  }

  let filename = await ask_('Output filename (without .md): ');

  filename = filename.trim();
  if (!filename) {
    console.error('Output filename is required.');
    if (rl) rl.close();
    process.exit(1);
  }
  if (!filename.endsWith('.md')) {
    filename += '.md';
  }

  const outputPath = path.join(PROMPTS_DIR, filename);

  if (fs.existsSync(outputPath)) {
    const confirm = await ask_(
      `File "${filename}" already exists. Overwrite? (y/N): `
    );
    if (confirm.trim().toLowerCase() !== 'y') {
      console.log('Aborted. File was not overwritten.');
      if (rl) rl.close();
      process.exit(0);
    }
  }

  const result = buildPromptContent(template, selectedAction, selectedScene);

  fs.writeFileSync(outputPath, result, 'utf8');
  console.log(`Saved: ${outputPath}`);

  if (rl) rl.close();
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
