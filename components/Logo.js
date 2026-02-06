'use client';

import Image from 'next/image';

export default function Logo({ className = '', variant = 'dark' }) {
  const src = variant === 'white' ? '/logo-white.svg' : '/logo.png';
  
  return (
    <Image 
      src={src}
      alt="Appreciate"
      width={100}
      height={115}
      className={className}
      priority
    />
  );
}

export function LogoLoader({ text = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="animate-bounce">
        <Logo variant="dark" className="w-16 h-auto" />
      </div>
      {text && <p className="text-slate-600 text-sm">{text}</p>}
    </div>
  );
}
