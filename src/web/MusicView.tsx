import React from 'react';
import { Song } from './songs';

type Props = {
  song: Song;
  onBack: () => void;
};

export default function MusicView({ song, onBack }: Props) {
  const display = song.raw
    .split('\n')
    .filter(l => !l.startsWith('% ') && l !== '%')
    .join('\n');

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur px-6 py-4 flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded"
        >
          ← Back
        </button>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{song.meta.title ?? 'Unknown'}</h1>
          {song.meta.artist && (
            <p className="text-sm text-gray-500">{song.meta.artist}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">
          {display}
        </pre>
      </main>
    </div>
  );
}
