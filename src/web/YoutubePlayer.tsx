import React, { useEffect, useRef } from 'react';

export type SeekRequest = {
  seconds: number;
  /** Bumped on every request so clicking the same timestamp twice still seeks. */
  nonce: number;
};

type Props = {
  videoId: string;
  seekRequest: SeekRequest | null;
};

// Only the pieces of the IFrame API surface this component touches.
type YtPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  destroy(): void;
};

// The IFrame API installs itself as one global and reports readiness through a
// single global callback, so every player on the page has to share one load.
let apiPromise: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>(resolve => {
    const w = window as any;
    if (w.YT?.Player) {
      resolve();
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });

  return apiPromise;
}

function applySeek(player: YtPlayer | null, request: SeekRequest): void {
  if (!player) return;
  player.seekTo(request.seconds, true);
  player.playVideo();
}

/**
 * YouTube embed driven through the IFrame Player API rather than a bare
 * `<iframe src=...>`: seeking with `?start=` would reload the embed and restart
 * playback, whereas the API lets a timestamp link seek the already-playing
 * video in place (tab-pinyinizer-0by).
 *
 * `playVideo()` is only ever called from a click handler, so the browser's
 * autoplay-with-sound policy is satisfied by that user gesture.
 */
export default function YoutubePlayer({ videoId, seekRequest }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<SeekRequest | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    readyRef.current = false;
    // A seek left over from the previous video must not replay on the new one.
    pendingSeekRef.current = null;

    // The API replaces whatever element it is handed with an <iframe>. Giving it
    // a detached child instead of the React-owned host keeps React's DOM
    // bookkeeping intact once the player is torn down.
    const mount = document.createElement('div');
    host.appendChild(mount);

    loadIframeApi().then(() => {
      if (cancelled) return;
      const w = window as any;
      playerRef.current = new w.YT.Player(mount, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin,
          rel: 0,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            readyRef.current = true;
            // Seeking before the player is ready would be dropped, so a
            // timestamp clicked during load is replayed here.
            const iframe = host.querySelector('iframe');
            if (iframe) {
              iframe.setAttribute(
                'allow',
                'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share'
              );
            }
            if (pendingSeekRef.current) applySeek(playerRef.current, pendingSeekRef.current);
          },
        },
      }) as YtPlayer;
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch {
        // The player never finished constructing, so there is nothing to tear down.
      }
      playerRef.current = null;
      mount.remove();
    };
  }, [videoId]);

  useEffect(() => {
    pendingSeekRef.current = seekRequest;
    if (!seekRequest || !readyRef.current) return;
    applySeek(playerRef.current, seekRequest);
  }, [seekRequest]);

  return (
    <div
      ref={hostRef}
      className="w-full aspect-video rounded overflow-hidden bg-black [&_iframe]:w-full [&_iframe]:h-full"
    />
  );
}
