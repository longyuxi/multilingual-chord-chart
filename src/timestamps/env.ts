// Dependency-free .env loading for the timestamp CLI. Credential provisioning
// itself is a human task (tab-pinyinizer-ilg.14): this module only makes a
// missing key fail with an error that says what to do.

import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from './paths';

export const API_KEY_NAMES = ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY'] as const;
export type ApiKeyName = (typeof API_KEY_NAMES)[number];

export const DOTENV_PATH = path.join(REPO_ROOT, '.env');

let loaded = false;

/**
 * Reads `<repo>/.env` into process.env without overwriting variables that are
 * already set, so a shell export or a CI secret always wins over the file.
 */
export function loadDotEnv(file: string = DOTENV_PATH): void {
  if (loaded) return;
  loaded = true;
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

/** Returns the key, or throws with the exact fix a human or agent should apply. */
export function requireApiKey(name: ApiKeyName, env: NodeJS.ProcessEnv = process.env): string {
  loadDotEnv();
  const value = env[name];
  if (value) return value;
  throw new Error(
    `${name} is not set. Add it to ${DOTENV_PATH} (gitignored) or export it; ` +
      `see .env.example for what each key is used for. Keys are provisioned by a ` +
      `human, tracked on tab-pinyinizer-ilg.14.`,
  );
}

/** Non-throwing presence check, for --dry-run cost reporting. */
export function hasApiKey(name: ApiKeyName, env: NodeJS.ProcessEnv = process.env): boolean {
  loadDotEnv();
  return Boolean(env[name]);
}
