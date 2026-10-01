import React, { useState, useMemo } from 'react';
import { Song } from './songs';
import { parseEcbBlocks, EcbBlock, EcbSegment } from './ecb-viewer-parser';
import { transposeChord } from './chord-transposer';

type Props = {
  song: Song;
  onBack: () => void;
};

type LyricFlowBlock = { kind: 'lyric_flow'; segments: EcbSegment[] };
type RenderBlock = EcbBlock | LyricFlowBlock;

// Merges consecutive lyric_line blocks into a single lyric_flow block so their
// segments can wrap freely instead of hard-breaking at each source line. Any
// other block kind (section, empty, free_text, ...) still ends the run, so
// verse/stanza breaks are always honored.
function groupForReflow(blocks: EcbBlock[]): RenderBlock[] {
  const result: RenderBlock[] = [];
  let current: EcbSegment[] | null = null;

  for (const block of blocks) {
    if (block.kind === 'lyric_line') {
      current = current ? [...current, ...block.segments] : [...block.segments];
      continue;
    }
    if (current) {
      result.push({ kind: 'lyric_flow', segments: current });
      current = null;
    }
    result.push(block);
  }
  if (current) result.push({ kind: 'lyric_flow', segments: current });

  return result;
}

const TEXT_SCALE_CLASSES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl'];

const FONT_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Small', value: -1 },
  { label: 'Normal', value: 0 },
  { label: 'Large', value: 1 },
  { label: 'X-Large', value: 2 },
  { label: 'XX-Large', value: 3 },
];

function scaledText(base: string, scale: number): string {
  const idx = TEXT_SCALE_CLASSES.indexOf(base);
  if (idx === -1) return base;
  const next = Math.min(TEXT_SCALE_CLASSES.length - 1, Math.max(0, idx + scale));
  return TEXT_SCALE_CLASSES[next];
}

function renderBlock(block: RenderBlock, idx: number, enabledLangs: Set<number>, transpose: number, scale: number): React.ReactNode {
  switch (block.kind) {
    case 'config_table':
      return (
        <React.Fragment key={idx}>
          <table className="mb-3">
            <thead>
              <tr>
                {block.entries.map(e => (
                  <th key={e.key} className={`pr-4 pb-1 ${scaledText('text-xs', scale)} font-semibold text-gray-400 uppercase tracking-wider text-left`}>
                    {e.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {block.entries.map(e => (
                  <td key={e.key} className={`pr-4 ${scaledText('text-sm', scale)} text-gray-600`}>
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
        <p key={idx} className={`mt-4 mb-1 pl-3 font-bold ${scaledText('text-sm', scale)} uppercase tracking-wide text-gray-700`}>
          {block.label}
        </p>
      );

    case 'free_text':
      return (
        <p key={idx} className={`${scaledText('text-sm', scale)} text-gray-600 italic`}>
          {block.text}
        </p>
      );

    case 'empty':
      return <div key={idx} className="h-3" />;

    case 'lyric_line': {
      const numLangs = Math.max(0, ...block.segments.map(s => s.lyrics.length));
      const showLang = Array.from({ length: numLangs }, (_, j) =>
        enabledLangs.has(j) && block.segments.some(seg => (seg.lyrics[j] ?? '') !== '')
      );
      return (
        <table key={idx} className="border-collapse my-2">
          <tbody>
            {/* Chord row */}
            <tr>
              {block.segments.map((seg, i) => {
                const { text: chordText, valid } = transposeChord(seg.chord, transpose);
                return (
                  <td key={i} className="pr-3 whitespace-nowrap">
                    <div className={`font-sans ${scaledText('text-sm', scale)} font-semibold min-h-[1.1em] ${valid ? 'text-sky-600' : 'text-red-500'}`}>
                      {chordText}
                    </div>
                  </td>
                );
              })}
            </tr>
            {/* One row per language */}
            {showLang.map((show, j) => show ? (
              <tr key={j} className="border-b border-gray-200">
                {block.segments.map((seg, i) => (
                  <td key={i} className="pr-3 whitespace-nowrap">
                    <div className={`font-sans ${scaledText('text-sm', scale)} min-h-[1.3em] text-gray-700`}>
                      {seg.lyrics[j] ?? ''}
                    </div>
                  </td>
                ))}
              </tr>
            ) : null)}
          </tbody>
        </table>
      );
    }

    case 'lyric_flow': {
      const numLangs = Math.max(0, ...block.segments.map(s => s.lyrics.length));
      const showLang = Array.from({ length: numLangs }, (_, j) =>
        enabledLangs.has(j) && block.segments.some(seg => (seg.lyrics[j] ?? '') !== '')
      );
      return (
        <div key={idx} className="flex flex-wrap items-start gap-x-3 gap-y-2 my-2">
          {block.segments.map((seg, i) => {
            const { text: chordText, valid } = transposeChord(seg.chord, transpose);
            return (
              <div key={i} className="whitespace-nowrap">
                <div className={`font-sans ${scaledText('text-sm', scale)} font-semibold min-h-[1.1em] ${valid ? 'text-sky-600' : 'text-red-500'}`}>
                  {chordText}
                </div>
                {showLang.map((show, j) => show ? (
                  <div key={j} className={`font-sans ${scaledText('text-sm', scale)} min-h-[1.3em] text-gray-700 border-b border-gray-200`}>
                    {seg.lyrics[j] ?? ''}
                  </div>
                ) : null)}
              </div>
            );
          })}
        </div>
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

function getYoutubeId(blocks: EcbBlock[]): string | null {
  for (const block of blocks) {
    if (block.kind === 'config_table') {
      const entry = block.entries.find(e => e.key === 'youtube');
      if (entry && entry.value) return entry.value.trim();
    }
  }
  return null;
}

const WIDTH_OPTIONS: { label: string; className: string }[] = [
  { label: 'Small', className: 'max-w-2xl' },
  { label: 'Normal', className: 'max-w-3xl' },
  { label: 'Large', className: 'max-w-4xl' },
  { label: 'X-Large', className: 'max-w-5xl' },
  { label: 'XX-Large', className: 'max-w-6xl' },
  { label: 'XXX-Large', className: 'max-w-7xl' },
  { label: '70% of window', className: 'w-[70%]' },
  { label: '100% of window', className: 'w-full' },
];

function getConfigTranspose(blocks: EcbBlock[]): number | null {
  for (const block of blocks) {
    if (block.kind === 'config_table') {
      const entry = block.entries.find(e => e.key === 'transpose');
      if (entry) {
        const n = parseInt(entry.value, 10);
        return isNaN(n) ? null : n;
      }
    }
  }
  return null;
}

export default function MusicView({ song, onBack }: Props) {
  const blocks = useMemo(() => parseEcbBlocks(song.raw), [song.raw]);
  const languages = useMemo(() => getLanguageNames(blocks), [blocks]);
  const configTranspose = useMemo(() => getConfigTranspose(blocks), [blocks]);
  const youtubeId = useMemo(() => getYoutubeId(blocks), [blocks]);

  const [showSource, setShowSource] = useState(false);
  const [enabledLangs, setEnabledLangs] = useState<Set<number>>(
    () => new Set(languages.map((_, i) => i))
  );
  const [transpose, setTranspose] = useState(0);
  const [reflow, setReflow] = useState(true);
  const [fontScale, setFontScale] = useState(1);
  const [widthIdx, setWidthIdx] = useState(WIDTH_OPTIONS.length - 1);

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
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur px-4 sm:px-6 py-3 sm:py-4 flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded shrink-0"
          >
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold leading-tight truncate">{song.meta.title ?? 'Unknown'}</h1>
            {song.meta.artist && (
              <p className="text-sm text-gray-700 truncate">{song.meta.artist}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {/* Reflow toggle */}
          <button
            onClick={() => setReflow(r => !r)}
            className={`px-2.5 py-1 rounded-full border text-xs font-semibold uppercase tracking-wide transition-colors ${
              reflow
                ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
            }`}
          >
            Reflow
          </button>

          {/* Font size control */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Size</span>
            <select
              value={fontScale}
              onChange={e => setFontScale(Number(e.target.value))}
              className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700 hover:border-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              {FONT_SCALE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Content width control (desktop only) */}
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Width</span>
            <select
              value={widthIdx}
              onChange={e => setWidthIdx(Number(e.target.value))}
              className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700 hover:border-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              {WIDTH_OPTIONS.map((opt, i) => (
                <option key={opt.className} value={i}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Transpose control */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTranspose(t => t - 1)}
                className="w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black transition-colors text-base leading-none"
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-mono text-gray-700 select-none">
                {transpose > 0 ? `+${transpose}` : transpose}
              </span>
              <button
                onClick={() => setTranspose(t => t + 1)}
                className="w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black transition-colors text-base leading-none"
              >
                +
              </button>
            </div>
            {configTranspose !== null && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setTranspose(0)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${transpose === 0 ? 'bg-gray-200 text-gray-800 font-medium' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                >
                  Transcribed
                </button>
                <button
                  onClick={() => setTranspose(configTranspose)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${transpose === configTranspose ? 'bg-gray-200 text-gray-800 font-medium' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                >
                  Actual
                </button>
              </div>
            )}
          </div>

          {/* Language toggles */}
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
        </div>
      </header>

      <main className={`mx-auto ${WIDTH_OPTIONS[widthIdx].className} px-4 sm:px-6 py-8`}>
        {(() => {
          const splitIdx = blocks.findIndex(b => b.kind === 'config_table');
          const before = splitIdx >= 0 ? blocks.slice(0, splitIdx + 1) : [];
          const afterRaw = splitIdx >= 0 ? blocks.slice(splitIdx + 1) : blocks;
          const after: RenderBlock[] = reflow ? groupForReflow(afterRaw) : afterRaw;
          return (
            <>
              {before.map((block, idx) => renderBlock(block, idx, enabledLangs, transpose, fontScale))}
              {youtubeId && (
                <div className="mb-6 w-4/5 mx-auto">
                  <iframe
                    className="w-full aspect-video rounded"
                    src={`https://www.youtube.com/embed/${youtubeId}`}
                    title="YouTube video player"
                    frameBorder="0"
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
              )}
              {after.map((block, idx) => renderBlock(block, splitIdx + 1 + idx, enabledLangs, transpose, fontScale))}
            </>
          );
        })()}

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
