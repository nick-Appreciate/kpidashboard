'use client';

import { useEffect, useRef, useState } from 'react';

export default function AnimatedText({
  text,
  className = '',
  delay = 30,
  tag: Tag = 'h1',
  animateBy = 'words',
}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const parts = animateBy === 'words' ? text.split(' ') : text.split('');
  const separator = animateBy === 'words' ? '\u00A0' : '';

  return (
    <Tag ref={ref} className={className}>
      {parts.map((part, i) => (
        <span
          key={i}
          className="inline-block transition-all duration-500"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0) blur(0)' : 'translateY(12px)',
            filter: isVisible ? 'blur(0px)' : 'blur(4px)',
            transitionDelay: `${i * delay}ms`,
          }}
        >
          {part}{i < parts.length - 1 ? separator : ''}
        </span>
      ))}
    </Tag>
  );
}
