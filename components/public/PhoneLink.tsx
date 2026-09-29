'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LEASING_PHONE, LEASING_PHONE_TEL } from '../../lib/listings';
import { getDictionary, type Locale } from '../../lib/i18n';

/**
 * The leasing number as a call-to-action.
 *
 * On a phone, `tel:` dials and that's the whole story. On a desktop browser
 * with no telephony handler registered, `tel:` does nothing at all — the
 * button looks broken. So on non-touch devices we intercept the click and
 * copy the number instead, which is what someone on a laptop actually wants.
 *
 * Touch detection drives the branch rather than screen width: a small window
 * on a desktop still can't dial, and a tablet still can.
 *
 * The copy is best-effort: `navigator.clipboard.writeText` is gated on a
 * permission that enterprise policy, an iframe's permissions-policy, or a
 * hardened browser can all deny, and `execCommand('copy')` can fail too. We've
 * already swallowed the click by then, so a silent failure would leave the
 * button looking exactly as broken as the bare `tel:` did. When both copy paths
 * fail we fall back to selecting the number in the page — no permission
 * involved — which leaves it highlighted and one ⌘C away.
 */
type CopyState = 'idle' | 'copied' | 'select';

/** Best-effort clipboard write. Returns true only on a confirmed success. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied — fall through to the legacy path.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function PhoneLink({
  locale,
  className,
  children,
  ariaLabel,
}: {
  locale: Locale;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const t = getDictionary(locale).phone;
  const [state, setState] = useState<CopyState>('idle');
  const labelRef = useRef<HTMLSpanElement>(null);

  const onClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      const canDial =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
      if (canDial) return; // let the tel: handler take it

      e.preventDefault();
      setState((await copyText(LEASING_PHONE)) ? 'copied' : 'select');
    },
    [],
  );

  // The 'select' label is the bare number, so the selection has to happen after
  // that render — selecting first would only highlight text React then replaces.
  useEffect(() => {
    if (state === 'idle') return;
    if (state === 'select' && labelRef.current) {
      const range = document.createRange();
      range.selectNodeContents(labelRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    const ms = state === 'copied' ? 2000 : 4000;
    const timer = window.setTimeout(() => setState('idle'), ms);
    return () => window.clearTimeout(timer);
  }, [state]);

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const title = state === 'select' ? t.pressToCopy(isMac ? '⌘C' : 'Ctrl+C') : t.clickToCopy;

  return (
    <a
      href={LEASING_PHONE_TEL}
      onClick={onClick}
      aria-label={ariaLabel ?? t.callUs(LEASING_PHONE)}
      title={title}
      className={className}
    >
      {/* Its own node so the fallback selects the number and nothing else —
          several call sites wrap the number in an icon and a "Call" prefix.
          display:contents keeps it from generating a box, so the icon and the
          text stay direct flex items of the anchor and the call sites' own
          `inline-flex items-center gap-*` still lines them up. */}
      <span ref={labelRef} style={{ display: 'contents' }}>
        {state === 'copied' ? t.copied : state === 'select' ? LEASING_PHONE : children}
      </span>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? t.copied : state === 'select' ? title : ''}
      </span>
    </a>
  );
}
