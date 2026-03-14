import React, { useState } from 'react';
import { songs, Song } from './songs';
import CatalogPage from './CatalogPage';
import MusicView from './MusicView';

export default function App() {
  const [selected, setSelected] = useState<Song | null>(null);

  return selected
    ? <MusicView song={selected} onBack={() => setSelected(null)} />
    : <CatalogPage songs={songs} onSelect={setSelected} />;
}
