"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Player siaran live di panel. Urutan sumber:
 *  1. Stream FLV langsung dari CDN Shopee (kalau CORS mengizinkan)
 *  2. Stream FLV via proxy server (/api/stream)
 *  3. Iframe halaman share Shopee (terakhir — bisa nyasar ke pemilih bahasa)
 */
export default function LivePlayer({ playUrl, shareUrl }: { playUrl: string; shareUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 0 = FLV langsung, 1 = FLV via proxy, 2 = iframe
  const [source, setSource] = useState(playUrl ? 0 : 2);

  useEffect(() => {
    setSource(playUrl ? 0 : 2);
  }, [playUrl]);

  useEffect(() => {
    if (source > 1 || !playUrl || !videoRef.current) return;
    let player: { destroy: () => void } | null = null;
    let cancelled = false;
    const url = source === 0 ? playUrl : `/api/stream?u=${encodeURIComponent(playUrl)}`;

    (async () => {
      try {
        const flvjs = (await import("flv.js")).default;
        if (cancelled || !videoRef.current) return;
        if (!flvjs.isSupported()) {
          setSource(2);
          return;
        }
        const p = flvjs.createPlayer(
          { type: "flv", isLive: true, url },
          { enableStashBuffer: false, autoCleanupSourceBuffer: true }
        );
        p.attachMediaElement(videoRef.current);
        p.on(flvjs.Events.ERROR, () => setSource((s) => s + 1));
        p.load();
        p.play()?.catch(() => {});
        player = p;
      } catch {
        setSource((s) => s + 1);
      }
    })();

    return () => {
      cancelled = true;
      try { player?.destroy(); } catch { /* ok */ }
    };
  }, [source, playUrl]);

  if (playUrl && source <= 1) {
    return (
      <video ref={videoRef} className="w-full h-full object-contain bg-black"
        controls muted autoPlay playsInline />
    );
  }

  if (shareUrl) {
    return (
      <iframe src={shareUrl} className="w-full h-full"
        allow="autoplay; fullscreen; encrypted-media" allowFullScreen />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 text-sm gap-2">
      <span className="text-3xl">📡</span>
      Menunggu siaran host…
    </div>
  );
}
