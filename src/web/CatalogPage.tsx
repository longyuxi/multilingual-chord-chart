import React from 'react';
import { Song } from './songs';

type Props = {
  songs: Song[];
  onSelect: (song: Song) => void;
};

export default function CatalogPage({ songs, onSelect }: Props) {
  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-gray-200 px-6 py-5">
        <h1 className="text-2xl font-bold tracking-tight">Multilingual Chord Charts</h1>
        <p className="mt-1 text-sm text-gray-500">Synchronized chord views for Chinese lyrics, pinyin, and English translations.</p>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
              <th className="pb-2 pr-8 w-1/3">Artist</th>
              <th className="pb-2">Title</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...songs].sort((a, b) => {
              const artist = (a.meta.artist ?? '').localeCompare(b.meta.artist ?? '');
              if (artist !== 0) return artist;
              return (a.meta.title ?? '').localeCompare(b.meta.title ?? '');
            }).map(song => (
              <tr
                key={song.id}
                onClick={() => onSelect(song)}
                className="cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <td className="py-3 pr-8 text-gray-500">
                  {song.meta.artist ?? 'Unknown'}
                </td>
                <td className="py-3 font-medium">
                  {song.meta.title ?? 'Unknown'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
