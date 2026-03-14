import React, { useState, useMemo } from 'react';
import { Song } from './songs';
import { parseEcbBlocks, EcbBlock } from './ecb-viewer-parser';

type Props = {
  song: Song;
  onBack: () => void;
};

function renderBlock(block: EcbBlock, idx: number, enabledLangs: Set<number>): React.ReactNode {
  switch (block.kind) {
    case 'config_table':
      return (
        <React.Fragment key={idx}>
          <table className="mb-3">
            <thead>
              <tr>
                {block.entries.map(e => (
                  <th key={e.key} className="pr-4 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider text-left">
                    {e.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {block.entries.map(e => (
                  <td key={e.key} className="pr-4 text-sm text-gray-600">
                    {e.value}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <hr className="border-gray-200 mb-4" />
        </React.Fragment>
      );

    case 'section':
      return (
        <p key={idx} className="mt-4 mb-1 pl-3 font-bold text-sm uppercase tracking-wide text-gray-700">
          {block.label}
        </p>
      );

    case 'free_text':
      return (
        <p key={idx} className="text-sm text-gray-600 italic">
          {block.text}
        </p>
      );

    case 'empty':
      return <div key={idx} className="h-3" />;

    case 'lyric_line': {
      const numLangs = Math.max(0, ...block.segments.map(s => s.lyrics.length));
      // Show a language row only if it's enabled AND at least one segment has content
      const showLang = Array.from({ length: numLangs }, (_, j) =>
        enabledLangs.has(j) && block.segments.some(seg => (seg.lyrics[j] ?? '') !== '')
      );
      return (
        <table key={idx} className="border-collapse my-2">
          <tbody>
            <tr className="align-top">
              {block.segments.map((seg, i) => (
                <td key={i} className="pr-3 align-top whitespace-nowrap">
                  <div className="text-sky-600 font-mono text-xs font-semibold min-h-[1.1em]">
                    {seg.chord}
                  </div>
                  {showLang.map((show, j) => show ? (
                    <div key={j} className="font-mono text-sm min-h-[1.3em] text-gray-700">
                      {seg.lyrics[j] ?? ''}
                    </div>
                  ) : null)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      );
    }
  }
}

function getLanguageNames(blocks: EcbBlock[]): string[] {
  for (const block of blocks) {
    if (block.kind === 'config_table') {
      const entry = block.entries.find(e => e.key === 'languages');
      if (entry) return entry.value.split(',').map(s => s.trim());
    }
  }
  return [];
}

export default function MusicView({ song, onBack }: Props) {
  const blocks = useMemo(() => parseEcbBlocks(song.raw), [song.raw]);
  const languages = useMemo(() => getLanguageNames(blocks), [blocks]);

  const [showSource, setShowSource] = useState(false);
  const [enabledLangs, setEnabledLangs] = useState<Set<number>>(
    () => new Set(languages.map((_, i) => i))
  );

  function toggleLang(i: number) {
    setEnabledLangs(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur px-6 py-4 flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded"
        >
          ← Back
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-tight">{song.meta.title ?? 'Unknown'}</h1>
          {song.meta.artist && (
            <p className="text-sm text-gray-700">{song.meta.artist}</p>
          )}
        </div>
        {languages.length > 0 && (
          <div className="flex items-center gap-2">
            {languages.map((lang, i) => (
              <button
                key={i}
                onClick={() => toggleLang(i)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  enabledLangs.has(i)
                    ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {blocks.map((block, idx) => renderBlock(block, idx, enabledLangs))}

        <div className="mt-12 border-t border-gray-200 pt-6">
          <button
            onClick={() => setShowSource(s => !s)}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            {showSource ? 'Hide Source' : 'Show Source'}
          </button>
          {showSource && (
            <div className="mt-4 relative">
              <button
                onClick={() => navigator.clipboard.writeText(song.raw)}
                className="absolute top-2 right-2 text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-200"
              >
                Copy
              </button>
              <pre className="font-mono text-xs text-gray-600 whitespace-pre-wrap break-words bg-gray-50 rounded p-4 pr-16">
                {song.raw}
              </pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
