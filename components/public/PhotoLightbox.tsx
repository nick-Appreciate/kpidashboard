'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { getDictionary, type Locale } from '../../lib/i18n';

interface Props {
  photos: string[];
  alt: string;
  /** Controlled open state */
  open: boolean;
  onClose: () => void;
  /** Index of photo to start with */
  initialIndex?: number;
  locale: Locale;
}

export default function PhotoLightbox({
  photos,
  alt,
  open,
  onClose,
  initialIndex = 0,
  locale,
}: Props) {
  const t = getDictionary(locale).lightbox;
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const prev = useCallback(() => {
    setIndex(i => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  const next = useCallback(() => {
    setIndex(i => (i + 1) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, prev, next]);

  if (!open || photos.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t.galleryLabel}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
        aria-label={t.closeGallery}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>

      {/* Counter */}
      <div className="absolute top-5 left-5 text-white/85 text-[13px] tabular-nums">
        {index + 1} / {photos.length}
      </div>

      {/* Prev */}
      {photos.length > 1 && (
        <button
          onClick={e => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-4 md:left-8 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label={t.prev}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Image */}
      <div
        className="relative w-full h-full max-w-[92vw] max-h-[85vh] md:max-w-[82vw] md:max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        <Image
          src={photos[index]}
          alt={`${alt} — photo ${index + 1}`}
          fill
          sizes="92vw"
          className="object-contain"
          unoptimized
          priority
        />
      </div>

      {/* Next */}
      {photos.length > 1 && (
        <button
          onClick={e => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-4 md:right-8 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label={t.next}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 px-3 py-2 bg-black/50 rounded-full max-w-[92vw] overflow-x-auto"
          onClick={e => e.stopPropagation()}
        >
          {photos.map((p, i) => (
            <button
              key={p}
              onClick={() => setIndex(i)}
              className={`relative w-14 h-10 rounded overflow-hidden flex-shrink-0 transition-all ${
                i === index ? 'ring-2 ring-white opacity-100' : 'opacity-60 hover:opacity-100'
              }`}
              aria-label={t.goToPhoto(i + 1)}
            >
              <Image src={p} alt="" fill sizes="56px" className="object-cover" unoptimized />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
