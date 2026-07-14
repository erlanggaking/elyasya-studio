"use client";

import { useEffect, useRef, useState } from "react";

type PlayerInstance = { destroy: () => void };

function proxied(url: string, sessionId: string) {
  return sessionId
    ? `/api/stream?session=${encodeURIComponent(sessionId)}`
    : `/api/stream?u=${encodeURIComponent(url)}`;
}

/** Memutar URL stream saja; halaman share Shopee tidak pernah dimuat di panel. */
export default function LivePlayer({ playUrl, sessionId }: { playUrl: string; sessionId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 0 = proxy server (mint URL segar tiap play — jalur terbukti), 1 = CDN langsung
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [playUrl, sessionId]);

  // Auto-retry: live bisa baru mulai / jeda sesaat — coba lagi tiap 12 detik.
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => { setAttempt(0); setFailed(false); }, 12000);
    return () => clearTimeout(t);
  }, [failed]);

  useEffect(() => {
    const video = videoRef.current;
    if ((!playUrl && !sessionId) || !video || failed) return;

    let player: PlayerInstance | null = null;
    let cancelled = false;
    const streamUrl = attempt === 0 ? proxied(playUrl, sessionId) : playUrl;
    const isHls = /\.m3u8(?:\?|$)/i.test(attempt === 0 ? "" : playUrl);

    const tryNextSource = () => {
      if (cancelled) return;
      if (attempt === 0 && playUrl) setAttempt(1);
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
          const hls = new Hls({
            lowLatencyMode: true,
            liveSyncDurationCount: 3,
            backBufferLength: 30,
          });
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
          {
            type: "flv",
            isLive: true,
            url: streamUrl,
            cors: true,
            // CDN mengirim ACAO "*"; credential mode justru membuat CORS gagal.
            withCredentials: false,
          },
          { enableStashBuffer: false, autoCleanupSourceBuffer: true }
        );
        flv.attachMediaElement(video);
        flv.on(flvjs.Events.ERROR, tryNextSource);
        flv.load();
        await Promise.resolve(flv.play()).catch(() => undefined);
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
  }, [attempt, failed, playUrl, sessionId]);

  if ((!playUrl && !sessionId) || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 text-sm gap-3 px-8 text-center">
        <span className="text-3xl" aria-hidden>📡</span>
        <span className="font-medium text-zinc-300">
          {failed ? "Video live belum dapat diputar" : "Menunggu stream video host"}
        </span>
        <span className="text-xs text-zinc-500">
          {failed
            ? "Mencoba ulang otomatis dalam beberapa detik… (pastikan host masih live)"
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
