"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Animated particle network: small dots drift slowly and draw a connecting
 * line to any neighbor within range. Pure canvas, no external deps, respects
 * prefers-reduced-motion, and resizes with its parent container.
 *
 * Tinted to the CRM's own teal accent (--primary / dark-mode --primary from
 * globals.css) rather than an arbitrary color, so it reads as this app's
 * brand mark, not a stock effect.
 *
 * Usage: drop <ParticleNetwork /> as the first child of a `relative` element
 * with a dark background — it absolutely fills that parent.
 */
export default function ParticleNetwork({
  className = "",
  opacity = 0.55,
}: {
  className?: string;
  opacity?: number;
}) {
  const ref = useCanvasNetwork();
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ opacity }}
    />
  );
}

type Particle = { x: number; y: number; vx: number; vy: number; r: number };

function useCanvasNetwork(): RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let rafId: number | null = null;

    const DENSITY = 9000; // px^2 per particle
    const LINK_DIST = 130;
    const SPEED = 0.18;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(18, Math.min(90, Math.floor((width * height) / DENSITY)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: Math.random() < 0.25 ? 2.2 : 1.3,
      }));
    }

    function step() {
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            ctx!.strokeStyle = `rgba(53, 181, 163, ${0.22 * (1 - dist / LINK_DIST)})`;
            ctx!.lineWidth = 0.6;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      for (const p of particles) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = "#35b5a3";
        ctx!.fill();
      }

      rafId = requestAnimationFrame(step);
    }

    resize();
    if (prefersReducedMotion) {
      step(); // draw one static frame, no loop
    } else {
      rafId = requestAnimationFrame(step);
    }

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return ref;
}
