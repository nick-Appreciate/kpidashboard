'use client';

/**
 * PreQualModal
 *
 * Opens when a visitor clicks "Apply Now" on a listing detail page.
 * Collects email + income + credit-score band (and optional move-in),
 * POSTs to /api/listings/prequal, and either passes the visitor on to
 * AppFolio's application URL or shows a polite "we'll save your info"
 * fallback.
 *
 * Built in response to the Phase 2b finding that 49% of KC apps get
 * denied — pre-qualifying upstream saves property-manager time and
 * gives the prospect immediate clarity on whether to apply.
 */

import { useEffect, useRef, useState } from 'react';
import { getDictionary, type Locale } from '../../lib/i18n';

type CreditBand = 'below_580' | '580_619' | '620_679' | '680_plus' | 'unsure';
type Step = 'form' | 'passed' | 'failed';

interface Props {
  open: boolean;
  onClose: () => void;
  listingId: string;
  listingRent: number;
  listingAddress?: string;
  applicationUrl: string;
  locale: Locale;
}

interface ApiResponse {
  passed: boolean;
  fail_reasons: string[];
  requirements: { min_income_monthly: number; min_credit_band: string };
}

const CREDIT_BAND_ORDER: CreditBand[] = ['below_580', '580_619', '620_679', '680_plus', 'unsure'];

function formatMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export default function PreQualModal({
  open, onClose,
  listingId, listingRent, listingAddress,
  applicationUrl, locale,
}: Props) {
  const t = getDictionary(locale).prequal;

  const [step, setStep]               = useState<Step>('form');
  const [email, setEmail]             = useState('');
  const [income, setIncome]           = useState('');
  const [creditBand, setCreditBand]   = useState<CreditBand | ''>('');
  const [moveIn, setMoveIn]           = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const [result, setResult]           = useState<ApiResponse | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens fresh
  useEffect(() => {
    if (open) {
      setStep('form');
      setEmail(''); setIncome(''); setCreditBand(''); setMoveIn('');
      setSubmitting(false); setErrorMsg(null); setResult(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const minIncomeForRent = listingRent * 3;
  const minIncomeFormatted = formatMoney(minIncomeForRent);

  const submit = async () => {
    setErrorMsg(null);
    const trimmedEmail = email.trim();
    const incomeNum = Number(String(income).replace(/[^0-9.]/g, ''));
    if (!trimmedEmail || !trimmedEmail.includes('@') || !incomeNum || !creditBand) {
      setErrorMsg(t.errorRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/listings/prequal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listingId,
          listing_address: listingAddress,
          listing_rent: listingRent,
          email: trimmedEmail,
          monthly_income: incomeNum,
          credit_band: creditBand,
          desired_move_in: moveIn || null,
          locale,
        }),
      });
      if (!res.ok) {
        setErrorMsg(t.errorSubmit);
        setSubmitting(false);
        return;
      }
      const body = (await res.json()) as ApiResponse;
      setResult(body);
      setStep(body.passed ? 'passed' : 'failed');
    } catch {
      setErrorMsg(t.errorSubmit);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prequal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        // Close on overlay click but not on dialog click
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        {step === 'form' && (
          <div className="p-7">
            <h2 id="prequal-title" className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A] mb-1">
              {t.title}
            </h2>
            <p className="text-[13px] text-[#0A0A0A]/60 mb-5">{t.subtitle}</p>

            <label className="block mb-4">
              <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.emailLabel}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.emailPlaceholder}
                className="w-full px-3 py-2.5 rounded-lg border border-black/10 focus:border-[#06b6d4] focus:outline-none text-[14px]"
                autoComplete="email"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.incomeLabel}</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0A0A0A]/40 text-[14px]">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={income}
                  onChange={(e) => setIncome(e.target.value)}
                  placeholder={t.incomePlaceholder}
                  className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-black/10 focus:border-[#06b6d4] focus:outline-none text-[14px]"
                />
              </div>
              <span className="block text-[11px] text-[#0A0A0A]/50 mt-1">{t.incomeHelp(minIncomeFormatted)}</span>
            </label>

            <fieldset className="mb-4">
              <legend className="block text-[12px] font-medium text-[#0A0A0A] mb-2">{t.creditLabel}</legend>
              <div className="space-y-1.5">
                {CREDIT_BAND_ORDER.map((band) => (
                  <label
                    key={band}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-[14px] transition-colors ${
                      creditBand === band
                        ? 'border-[#06b6d4] bg-[#06b6d4]/5'
                        : 'border-black/10 hover:border-black/20'
                    }`}
                  >
                    <input
                      type="radio"
                      name="credit"
                      value={band}
                      checked={creditBand === band}
                      onChange={() => setCreditBand(band)}
                      className="accent-[#06b6d4]"
                    />
                    <span>{t.creditBands[band]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block mb-5">
              <span className="block text-[12px] font-medium text-[#0A0A0A] mb-1">{t.moveInLabel}</span>
              <input
                type="date"
                value={moveIn}
                onChange={(e) => setMoveIn(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-black/10 focus:border-[#06b6d4] focus:outline-none text-[14px]"
              />
              <span className="block text-[11px] text-[#0A0A0A]/50 mt-1">{t.moveInHelp}</span>
            </label>

            {errorMsg && (
              <div className="mb-3 text-[13px] text-rose-600 bg-rose-50 border border-rose-100 px-3 py-2 rounded-lg">
                {errorMsg}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full px-4 py-3 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? t.submitting : t.submit}
            </button>
            <button
              onClick={onClose}
              disabled={submitting}
              className="w-full mt-2 px-4 py-2 rounded-full text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A] transition-colors"
            >
              {t.cancel}
            </button>
          </div>
        )}

        {step === 'passed' && result && (
          <div className="p-7 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="font-[var(--font-fraunces)] text-[24px] text-[#0A0A0A] mb-2">{t.passedTitle}</h2>
            <p className="text-[13px] text-[#0A0A0A]/60 mb-5">{t.passedBody}</p>
            <a
              href={applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full px-4 py-3 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
            >
              {t.continueToApp}
            </a>
            <button
              onClick={onClose}
              className="w-full mt-2 px-4 py-2 rounded-full text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A] transition-colors"
            >
              {t.close}
            </button>
          </div>
        )}

        {step === 'failed' && result && (
          <div className="p-7 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="font-[var(--font-fraunces)] text-[24px] text-[#0A0A0A] mb-2">{t.failedTitle}</h2>
            <p className="text-[13px] text-[#0A0A0A]/65 mb-5">
              {t.failedBody(formatMoney(result.requirements.min_income_monthly))}
            </p>
            <ul className="text-left text-[12px] text-[#0A0A0A]/70 mb-5 bg-black/[0.02] rounded-lg p-3 space-y-1">
              <li>• {t.failedRequirementIncome(formatMoney(result.requirements.min_income_monthly))}</li>
              <li>• {t.failedRequirementCredit}</li>
            </ul>
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
