'use client';

/**
 * InquiryModal — "Schedule a tour" / "Ask a question" on a listing page.
 *
 * Tour mode: pick a real open time from the property manager's AppFolio
 * calendar (/api/listings/availability, paged forward past weekends,
 * holidays and booked-up days) → contact info → booked on that calendar.
 * If no times load, it falls back to a plain request.
 *
 * Everything POSTs to /api/listings/inquiry, which records the lead, creates
 * the AppFolio guest card, books the showing and fires our instant text.
 */

import { useCallback, useEffect, useState } from 'react';
import { getDictionary, type Locale } from '../../lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  listingId: string;
  mode: 'tour' | 'question';
  locale: Locale;
}

interface Slot { time: string; agentId: number }
interface Day { date: string; slots: Slot[] }

type Step = 'time' | 'contact' | 'done';

const TZ = 'America/Chicago';
const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-black/10 focus:border-[#06b6d4] focus:outline-none text-[14px]';

const formatPhone = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function InquiryModal({ open, onClose, listingId, mode, locale }: Props) {
  const t = getDictionary(locale).inquiry;
  const lang = locale === 'es' ? 'es-US' : 'en-US';
  const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(lang, { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(lang, { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const [step, setStep] = useState<Step>('contact');
  const [requestOnly, setRequestOnly] = useState(false); // tour without a picked time

  // Availability paging: `pages` holds each page's start date so Earlier works.
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [days, setDays] = useState<Day[]>([]);
  const [futureExists, setFutureExists] = useState(false);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [timesError, setTimesError] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [moveIn, setMoveIn] = useState('');
  const [message, setMessage] = useState('');
  const [smsConsent, setSmsConsent] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ booked: boolean; when: string | null; textedTo: string | null } | null>(null);

  const loadTimes = useCallback(async (start: string | undefined) => {
    setLoadingTimes(true); setTimesError(false);
    try {
      const q = new URLSearchParams({ listing_id: listingId });
      if (start) q.set('start', start);
      const res = await fetch(`/api/listings/availability?${q}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      const withSlots: Day[] = (body.days || []).filter((d: Day) => d.slots.length);
      setDays(body.days || []);
      setFutureExists(!!body.futureExists);
      setActiveDay(withSlots[0]?.date ?? null);
    } catch {
      setTimesError(true); setDays([]);
    } finally {
      setLoadingTimes(false);
    }
  }, [listingId]);

  useEffect(() => {
    if (!open) return;
    setStep(mode === 'tour' ? 'time' : 'contact');
    setRequestOnly(false); setSlot(null); setNotice(null); setErrorMsg(null);
    setSubmitting(false); setResult(null); setInquiryId(null);
    setPages([undefined]);
    if (mode === 'tour') loadTimes(undefined);
  }, [open, mode, loadTimes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const digits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const daysWithSlots = days.filter((d) => d.slots.length);
  const lastDate = days.length ? days[days.length - 1].date : null;

  const goLater = () => {
    if (!lastDate) return;
    const next = addDays(lastDate, 1);
    setPages((p) => [...p, next]);
    loadTimes(next);
  };
  const goEarlier = () => {
    if (pages.length < 2) return;
    const prev = pages.slice(0, -1);
    setPages(prev);
    loadTimes(prev[prev.length - 1]);
  };

  const submit = async () => {
    setErrorMsg(null);
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (slot) {
      // Booking a tour needs a phone so we can confirm and remind.
      if (!first.trim() || digits.length !== 10) { setErrorMsg(t.phoneRequired); return; }
    } else if (!first.trim() || (digits.length !== 10 && !hasEmail)) {
      setErrorMsg(t.errorRequired); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/listings/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listingId,
          first_name: first.trim(),
          last_name: last.trim(),
          phone: digits.length === 10 ? digits : '',
          email: email.trim(),
          move_in: moveIn || null,
          message: message.trim(),
          wants_tour: mode === 'tour',
          sms_consent: smsConsent,
          marketing_consent: marketing,
          slot_time: slot?.time ?? null,
          slot_agent_id: slot?.agentId ?? null,
          inquiry_id: inquiryId,
          locale,
          website,
        }),
      });
      if (res.status === 409) {
        const body = await res.json();
        setInquiryId(body.inquiry_id || null);
        setSlot(null);
        setNotice(t.slotTaken);
        setStep('time');
        loadTimes(pages[pages.length - 1]);
        return;
      }
      if (!res.ok) { setErrorMsg(t.errorSubmit); return; }
      const body = await res.json();
      const textedTo = body.texted && smsConsent && digits.length === 10 ? formatPhone(digits) : null;
      setResult({ booked: !!body.booked, when: body.showing_start ? fmtWhen(body.showing_start) : null, textedTo });
      setStep('done');
    } catch {
      setErrorMsg(t.errorSubmit);
    } finally {
      setSubmitting(false);
    }
  };

  const activeSlots = daysWithSlots.find((d) => d.date === activeDay)?.slots ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inquiry-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {step === 'time' && (
          <div className="p-7">
            <h2 id="inquiry-title" className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A] mb-1">{t.pickTime}</h2>
            <p className="text-[13px] text-[#0A0A0A]/60 mb-4">{t.pickTimeSub}</p>

            {notice && (
              <div className="mb-3 text-[13px] text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">{notice}</div>
            )}

            {loadingTimes ? (
              <p className="py-10 text-center text-[13px] text-[#0A0A0A]/50">{t.loadingTimes}</p>
            ) : timesError || daysWithSlots.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[13px] text-[#0A0A0A]/60 mb-4">{timesError ? t.timesError : t.noTimes}</p>
                {!timesError && futureExists && (
                  <button onClick={goLater} className="mb-3 text-[13px] font-medium text-[#0891b2] hover:underline">{t.laterDates}</button>
                )}
                <button
                  onClick={() => { setRequestOnly(true); setSlot(null); setStep('contact'); }}
                  className="block w-full px-4 py-3 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
                >
                  {t.noTimesCta}
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1" role="tablist">
                  {daysWithSlots.map((d) => (
                    <button
                      key={d.date}
                      role="tab"
                      aria-selected={d.date === activeDay}
                      onClick={() => setActiveDay(d.date)}
                      className={`shrink-0 px-3 py-2 rounded-lg border text-[12px] font-medium transition-colors ${d.date === activeDay ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-black/10 text-[#0A0A0A] hover:border-[#0A0A0A]/40'}`}
                    >
                      {fmtDay(d.date)}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {activeSlots.map((s) => (
                    <button
                      key={s.time}
                      onClick={() => { setSlot(s); setNotice(null); setStep('contact'); }}
                      className="px-2 py-2.5 rounded-lg border border-black/10 text-[13px] font-medium text-[#0A0A0A] hover:border-[#0891b2] hover:text-[#0891b2] transition-colors"
                    >
                      {fmtTime(s.time)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <button onClick={goEarlier} disabled={pages.length < 2} className="font-medium text-[#0891b2] disabled:text-[#0A0A0A]/25 hover:underline disabled:no-underline">{t.earlierDates}</button>
                  <button onClick={goLater} disabled={!futureExists && !lastDate} className="font-medium text-[#0891b2] hover:underline">{t.laterDates}</button>
                </div>
                <button
                  onClick={() => { setRequestOnly(true); setSlot(null); setStep('contact'); }}
                  className="block w-full mt-4 text-center text-[12px] text-[#0A0A0A]/55 hover:text-[#0A0A0A]"
                >
                  {t.noTimesCta}
                </button>
              </>
            )}
            <button onClick={onClose} className="w-full mt-3 px-4 py-2 rounded-full text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A] transition-colors">{t.cancel}</button>
          </div>
        )}

        {step === 'contact' && (
          <div className="p-7">
            <h2 id="inquiry-title" className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A] mb-1">
              {mode === 'tour' ? t.title : t.questionTitle}
            </h2>
            {slot ? (
              <div className="flex items-center justify-between gap-3 mb-5 px-3 py-2.5 rounded-lg bg-[#06b6d4]/10 text-[13px]">
                <span><span className="text-[#0A0A0A]/60">{t.yourTour}: </span><span className="font-medium text-[#0A0A0A]">{fmtWhen(slot.time)}</span></span>
                <button onClick={() => setStep('time')} className="shrink-0 font-medium text-[#0891b2] hover:underline">{t.changeTime}</button>
              </div>
            ) : (
              <p className="text-[13px] text-[#0A0A0A]/60 mb-5">{mode === 'tour' ? t.subtitle : t.questionSubtitle}</p>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="block">
                <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.firstName}</span>
                <input value={first} onChange={(e) => setFirst(e.target.value)} className={inputCls} autoComplete="given-name" />
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.lastName}</span>
                <input value={last} onChange={(e) => setLast(e.target.value)} className={inputCls} autoComplete="family-name" />
              </label>
            </div>

            <label className="block mb-4">
              <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.phone}</span>
              <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} autoComplete="tel" placeholder="(816) 555-0123" />
            </label>

            <label className="block mb-4">
              <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.email}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} autoComplete="email" />
            </label>

            {!slot && (
              <label className="block mb-4">
                <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.moveIn}</span>
                <input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} className={inputCls} />
              </label>
            )}

            <label className="block mb-4">
              <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.message}</span>
              <textarea rows={slot ? 2 : 3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t.messagePlaceholder} className={inputCls} />
            </label>

            {/* Honeypot — hidden from people, irresistible to bots. */}
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)}
              className="sr-only" aria-hidden="true" name="website" />

            <label className="flex items-start gap-2 mb-2 text-[12px] text-[#0A0A0A]/70">
              <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 accent-[#0891b2]" />
              <span>{t.smsConsent}</span>
            </label>
            <label className="flex items-start gap-2 mb-5 text-[12px] text-[#0A0A0A]/70">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 accent-[#0891b2]" />
              <span>{t.marketingConsent}</span>
            </label>

            {errorMsg && (
              <div className="mb-3 text-[13px] text-rose-600 bg-rose-50 border border-rose-100 px-3 py-2 rounded-lg">{errorMsg}</div>
            )}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full px-4 py-3 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (slot ? t.booking : t.submitting) : (slot ? t.bookTour : t.submit)}
            </button>
            <button
              onClick={() => (mode === 'tour' && !requestOnly ? setStep('time') : mode === 'tour' ? (setRequestOnly(false), setStep('time')) : onClose())}
              disabled={submitting}
              className="w-full mt-2 px-4 py-2 rounded-full text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A] transition-colors"
            >
              {mode === 'tour' ? t.back : t.cancel}
            </button>
          </div>
        )}

        {step === 'done' && result && (
          <div className="p-7 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="font-[var(--font-fraunces)] text-[24px] text-[#0A0A0A] mb-2">{result.booked ? t.bookedTitle : t.successTitle}</h2>
            {result.booked && result.when && <p className="text-[14px] font-medium text-[#0A0A0A] mb-2">{t.bookedBody(result.when)}</p>}
            <p className="text-[13px] text-[#0A0A0A]/60 mb-5">
              {result.booked
                ? (result.textedTo ? t.bookedText(result.textedTo) : '')
                : (result.textedTo ? t.successBody(result.textedTo) : t.successBodyNoPhone)}
            </p>
            <button
              onClick={onClose}
              className="w-full px-4 py-3 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
            >
              {t.close}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
