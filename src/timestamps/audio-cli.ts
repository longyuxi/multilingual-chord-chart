// Debug entry point for the audio stage (tab-pinyinizer-ilg.1). The real caller is
// the `npm run timestamps` CLI (ilg.6); this exists so the audio cache, the
// download and the duration probe can be exercised on a single song.
//
// Usage: node dist/timestamps/audio-cli.js <song.ecb> [--force]

import * as fs from 'fs';

import { prepareAudio } from './audio';

function main(argv: string[]): number {
  const [ecbPath, ...flags] = argv;
  if (!ecbPath) {
    console.error('Usage: node dist/timestamps/audio-cli.js <song.ecb> [--force]');
    return 2;
  }
  const force = flags.includes('--force');

  const ecbRaw = fs.readFileSync(ecbPath, 'utf8');
  const result = prepareAudio(ecbRaw, { force });
  if (result.status === 'skipped') {
    console.log(`${ecbPath}: ${result.message}`);
    return 0;
  }
  console.log(
    `${ecbPath}: ${result.videoId} ${result.durationSec.toFixed(2)}s ` +
      `${result.fromCache ? 'cached' : 'downloaded'} ${result.audioPath}`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`audio-cli: ${(error as Error).message}`);
  process.exitCode = 1;
}
