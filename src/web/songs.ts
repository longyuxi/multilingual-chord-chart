import { parseEcbMeta, EcbMeta } from './ecb-parser';

const rawFiles = import.meta.glob('/songs/*.ecb', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type Song = {
  id: string;
  meta: EcbMeta;
  raw: string;
}

export const songs: Song[] = Object.entries(rawFiles).map(([path, raw]) => ({
  id: path.replace(/^.*\/(.+)\.ecb$/, '$1'),
  meta: parseEcbMeta(raw),
  raw,
}));
