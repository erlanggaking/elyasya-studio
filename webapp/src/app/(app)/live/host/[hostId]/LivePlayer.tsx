"use client";

import { useEffect, useRef, useState } from "react";

type PlayerInstance = { destroy: () => void };

function proxied(url: string) {
  return `/api/stream?u=${encodeURIComponent(url)}`;
}

/** Memutar URL stream saja; halaman share Shopee tidak pernah dimuat di panel. */
export default function LivePlayer({ playUrl }: { playUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0); // 0 = CDN langsung, 1 = proxy server
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [playUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!playUrl || !video || failed) return;

    let player: PlayerInstance | null = null;
    let cancelled = false;
    const streamUrl = attempt === 0 ? playUrl : proxied(playUrl);
    const isHls = /\.m3u8(?:\?|$)/i.test(playUrl);

    const tryNextSource = () => {
      if (cancelled) return;
      if (attempt === 0) setAttempt(1);
      else setFailed(true);
    };

    (async () => {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();

        if (isHls) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = streamUrl;
            video.addEventListener("error", tryNextSource, { once: true });
            await video.play().catch(() => undefined);
            return;
          }

          const Hls = (await import("hls.js")).default;
          if (cancelled || !Hls.isSupported()) return tryNextSource();
          const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, backBufferLength: 30 });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) tryNextSource();
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => undefined));
          player = hls;
          return;
        }

        const flvjs = (await import("flv.js")).default;
        if (cancelled || !flvjs.isSupported()) return tryNextSource();
        const flv = flvjs.createPlayer(
          { type: "flv", isLive: true, url: streamUrl },
          { enableStashBuffer: false, autoCleanupSourceBuffer: true }
        );
        flv.attachMediaElement(video);
        flv.on(flvjs.Events.ERROR, tryNextSource);
        flv.load();
        flv.play()?.catch(() => undefined);
        player = flv;
      } catch {
        tryNextSource();
      }
    })();

    return () => {
      cancelled = true;
      video.removeEventListener("error", tryNextSource);
      try { player?.destroy(); } catch { /* player sudah berhenti */ }
    };
  }, [attempt, failed, playUrl]);

  if (!playUrl || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 text-sm gap-3 px-8 text-center">
        <span className="text-3xl" aria-hidden>📡</span>
        <span className="font-medium text-zinc-300">
          {failed ? "Video live belum dapat diputar" : "Menunggu stream video host"}
        </span>
        <span className="text-xs text-zinc-500">
          {failed
            ? "URL video tidak tersedia atau sudah kedaluwarsa. Muat ulang player untuk mencoba lagi."
            : "Panel akan menampilkan video otomatis setelah URL stream diterima."}
        </span>
      </div>
    );
  }

  return (
    <video ref={videoRef} className="w-full h-full object-contain bg-black"
      controls muted autoPlay playsInline />
  );
}
