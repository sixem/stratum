// Draw a live spectrum from the one playing track with a fixed-size canvas.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const BAR_COUNT = 36;
const FRAME_INTERVAL_MS = 1000 / 30;

export const AudioPreviewSpectrum = ({ mediaRef }: { mediaRef: RefObject<HTMLMediaElement | null> }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const media = mediaRef.current;
    const canvas = canvasRef.current;
    const drawing = canvas?.getContext("2d");
    if (!media || !canvas || !drawing || typeof AudioContext === "undefined") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listeners = new AbortController();
    const { signal } = listeners;
    let context: AudioContext | undefined;
    let source: MediaElementAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let samples: Uint8Array<ArrayBuffer> | undefined;
    let frame: number | null = null;
    let lastDraw = 0;
    let waiting = false;
    let failed = false;
    drawing.fillStyle = getComputedStyle(canvas).color;

    const canDraw = () => !failed && !signal.aborted && !media.paused && !media.ended &&
      !waiting && !document.hidden && !motion.matches;
    const stopFrames = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      canvas.dataset.active = "false";
    };
    const draw = (now: number) => {
      frame = null;
      if (!canDraw() || !analyser || !samples) {
        stopFrames();
        return;
      }
      if (now - lastDraw >= FRAME_INTERVAL_MS) {
        lastDraw = now;
        analyser.getByteFrequencyData(samples);
        drawing.clearRect(0, 0, canvas.width, canvas.height);
        const spacing = canvas.width / BAR_COUNT;
        for (let index = 0; index < BAR_COUNT; index += 1) {
          const bin = Math.floor(Math.pow(index / BAR_COUNT, 2) * samples.length * 0.55);
          const height = Math.max(2, samples[bin] / 255 * canvas.height);
          drawing.fillRect(index * spacing + spacing / 4, (canvas.height - height) / 2, spacing / 2, height);
        }
      }
      frame = window.requestAnimationFrame(draw);
    };

    const start = async () => {
      if (!canDraw() || frame !== null) return;
      try {
        context ??= new AudioContext();
        await context.resume();
        if (!canDraw() || frame !== null) return;
        if (!analyser) {
          const next = context.createAnalyser();
          next.fftSize = 1024;
          source = context.createMediaElementSource(media);
          source.connect(next);
          next.connect(context.destination);
          analyser = next;
          samples = new Uint8Array(next.frequencyBinCount);
        }
        canvas.dataset.active = "true";
        frame = window.requestAnimationFrame(draw);
      } catch {
        failed = true;
        if (signal.aborted) return;
        // Preserve output if the graph was only partly connected.
        if (source && context) {
          source.disconnect();
          source.connect(context.destination);
        } else {
          void context?.close().catch(() => {});
          context = undefined;
        }
      }
    };
    const resumeFrames = () => { if (canDraw()) void start(); else stopFrames(); };
    const suspend = () => {
      stopFrames();
      void context?.suspend().catch(() => {});
    };
    media.addEventListener("playing", () => { waiting = false; void start(); }, { signal });
    media.addEventListener("waiting", () => { waiting = true; stopFrames(); }, { signal });
    media.addEventListener("pause", suspend, { signal });
    media.addEventListener("ended", suspend, { signal });
    media.addEventListener("error", stopFrames, { signal });
    document.addEventListener("visibilitychange", resumeFrames, { signal });
    motion.addEventListener("change", resumeFrames, { signal });
    return () => {
      listeners.abort();
      stopFrames();
      source?.disconnect();
      analyser?.disconnect();
      void context?.close().catch(() => {});
    };
  }, [mediaRef]);

  return <canvas ref={canvasRef} className="quick-preview-audio-spectrum" width={384} height={64} aria-hidden="true" />;
};
