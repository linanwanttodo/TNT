"use client";

import { useEffect, useRef } from "react";

/**
 * Hero animation: a field of solid dots drifts in from noise and settles into
 * the letters "TNT" — the dsh whale treatment, redrawn for TNT. Flat colour
 * only (near-black dots with a few brand-blue strays), no gradients, no glow.
 * Honours prefers-reduced-motion by drawing the settled frame once.
 */
export function LandingParticles(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const WORD = "TNT";
    const DOT = 2.0;
    const EASE = 0.045;

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = true;

    interface Dot {
      x: number;
      y: number;
      tx: number;
      ty: number;
      blue: boolean;
      phase: number;
    }
    let dots: Dot[] = [];

    const sample = (): Array<{ x: number; y: number }> => {
      const off = document.createElement("canvas");
      const size = Math.min(width * 0.62, 560);
      const font = Math.floor(size / 2.1);
      off.width = size;
      off.height = font * 1.3;
      const c = off.getContext("2d");
      if (!c) return [];
      c.fillStyle = "#000";
      c.font = `900 ${font}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(WORD, off.width / 2, off.height / 2);
      const image = c.getImageData(0, 0, off.width, off.height).data;
      const points: Array<{ x: number; y: number }> = [];
      const step = 4;
      for (let y = 0; y < off.height; y += step) {
        for (let x = 0; x < off.width; x += step) {
          if (image[(y * off.width + x) * 4 + 3]! > 128) {
            points.push({
              x: x + (width - off.width) / 2,
              y: y + 24,
            });
          }
        }
      }
      return points;
    };

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      const targets = sample();
      dots = targets.map((point, index) => ({
        tx: point.x,
        ty: point.y,
        x: Math.random() * width,
        y: Math.random() * height,
        blue: index % 17 === 0,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const t = Date.now() / 1000;
      for (const dot of dots) {
        if (running && !reduced) {
          dot.x += (dot.tx - dot.x) * EASE;
          dot.y += (dot.ty - dot.y) * EASE + Math.sin(t + dot.phase) * 0.12;
        } else {
          dot.x = dot.tx;
          dot.y = dot.ty;
        }
        ctx.fillStyle = dot.blue ? "#0284c7" : "rgba(17, 17, 17, 0.82)";
        ctx.fillRect(dot.x, dot.y, DOT, DOT);
      }
      if (running && !reduced) {
        raf = requestAnimationFrame(draw);
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        build();
        draw();
      }, 150);
    };

    build();
    draw();
    window.addEventListener("resize", onResize);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="landing-particles"
      aria-label="TNT"
      role="img"
    />
  );
}
