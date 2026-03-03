'use client';

import { useEffect, useRef } from 'react';

export default function Aurora({
  color1 = '#06b6d4',
  color2 = '#8b5cf6',
  color3 = '#06b6d4',
  speed = 1,
  opacity = 0.15,
  className = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationId;
    let time = 0;

    function resize() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }

    function draw() {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Flowing aurora gradient
      for (let i = 0; i < 3; i++) {
        const colors = [color1, color2, color3];
        const gradient = ctx.createRadialGradient(
          width * (0.3 + i * 0.2 + Math.sin(time * 0.3 + i * 2) * 0.15),
          height * (0.3 + Math.cos(time * 0.2 + i * 1.5) * 0.2),
          0,
          width * 0.5,
          height * 0.5,
          width * 0.6
        );
        gradient.addColorStop(0, colors[i] + '40');
        gradient.addColorStop(0.5, colors[i] + '15');
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      time += 0.005 * speed;
      animationId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [color1, color2, color3, speed, opacity]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className}`}
      style={{ opacity }}
    />
  );
}
