export type EcbMeta = {
  title?: string;
  artist?: string;
  subtitle?: string;
  artist_subtitle?: string;
  languages?: string;
}

export function parseEcbMeta(raw: string): EcbMeta {
  const meta: EcbMeta = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^%%(\w+)\s+(.*)/);
    if (m) meta[m[1] as keyof EcbMeta] = m[2].trim();
  }
  return meta;
}
