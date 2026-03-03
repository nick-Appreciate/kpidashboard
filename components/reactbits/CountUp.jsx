'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export default function CountUp({
  to,
  from = 0,
  duration = 1.5,
  delay = 0,
  className = '',
  separator = ',',
  decimals = 0,
  prefix = '',
  suffix = '',
}) {
  const ref = useRef(null);
  const [hasStarted, setHasStarted] = useState(false);

  const formatValue = useCallback(
    (val) => {
      const fixed = val.toFixed(decimals);
      if (!separator) return `${prefix}${fixed}${suffix}`;
      const [intPart, decPart] = fixed.split('.');
      const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
      return `${prefix}${decPart ? `${formatted}.${decPart}` : formatted}${suffix}`;
    },
    [decimals, separator, prefix, suffix]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasStarted || !ref.current) return;

    const el = ref.current;
    let startTime = null;
    let animationId = null;

    const delayMs = delay * 1000;
    const durationMs = duration * 1000;

    const timeoutId = setTimeout(() => {
      const animate = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / durationMs, 1);

        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = from + (to - from) * eased;

        el.textContent = formatValue(current);

        if (progress < 1) {
          animationId = requestAnimationFrame(animate);
        }
      };
      animationId = requestAnimationFrame(animate);
    }, delayMs);

    return () => {
      clearTimeout(timeoutId);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [hasStarted, from, to, duration, delay, formatValue]);

  return (
    <span className={className} ref={ref}>
      {formatValue(from)}
    </span>
  );
}
