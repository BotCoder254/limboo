/**
 * Live audio waveform — a modern, ChatGPT-style row of rounded bars driven by
 * a Web Audio AnalyserNode (the mic capture graph). Canvas-based so 60fps
 * animation never touches React state. Honors reduced motion by rendering a
 * slow-updating static level instead of the animated bars.
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/renderer/lib/cn';

export function Waveform({
  analyser,
  height = 28,
  className,
}: {
  /** Live analyser from the active capture, or null for a flat idle row. */
  analyser: AnalyserNode | null;
  height?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--color-accent').trim() || '#6e9bff';
    const faint = styles.getPropertyValue('--color-line-strong').trim() || '#2a2a2a';
    const reducedMotion = document.documentElement.dataset.reducedMotion === 'true';

    const dpr = window.devicePixelRatio || 1;
    let raf = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barWidth = 3 * dpr;
      const gap = 3 * dpr;
      const count = Math.max(8, Math.floor(w / (barWidth + gap)));
      const mid = h / 2;

      if (analyser && data) analyser.getByteFrequencyData(data);

      for (let i = 0; i < count; i++) {
        let level = 0;
        if (data) {
          // Spread the bars over the voice-relevant lower half of the spectrum.
          const bin = Math.floor((i / count) * (data.length * 0.5));
          level = data[bin] / 255;
        }
        const minBar = 2 * dpr;
        const barH = Math.max(minBar, level * (h - 4 * dpr));
        const x = i * (barWidth + gap) + gap / 2;
        ctx.fillStyle = level > 0.02 ? accent : faint;
        ctx.beginPath();
        const radius = barWidth / 2;
        const top = mid - barH / 2;
        ctx.moveTo(x, top + radius);
        ctx.arcTo(x, top, x + barWidth, top, radius);
        ctx.arcTo(x + barWidth, top, x + barWidth, top + barH, radius);
        ctx.arcTo(x + barWidth, top + barH, x, top + barH, radius);
        ctx.arcTo(x, top + barH, x, top, radius);
        ctx.closePath();
        ctx.fill();
      }
    };

    if (reducedMotion) {
      draw();
      interval = setInterval(draw, 250);
    } else {
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (interval) clearInterval(interval);
    };
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('w-full', className)}
      style={{ height }}
      aria-hidden="true"
    />
  );
}
