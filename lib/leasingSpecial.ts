/**
 * The current leasing special ("Winter Leasing Special", …) — one active row
 * in leasing_specials, edited on Leasing Automations. Drives the website promo
 * banner and the lead engine's follow-up text #2, so changing it in one place
 * updates both. Public read (anon) is limited to the active row by RLS.
 */
import { supabase } from './supabase';
import type { Locale } from './i18n';

export interface LeasingSpecial {
  id: string;
  name_en: string;
  name_es: string;
  details_en: string | null;
  details_es: string | null;
}

export async function fetchCurrentSpecial(): Promise<LeasingSpecial | null> {
  const { data, error } = await supabase
    .from('leasing_specials')
    .select('id, name_en, name_es, details_en, details_es')
    .eq('active', true)
    .maybeSingle();
  if (error) return null;
  return (data as LeasingSpecial) || null;
}

export const specialName = (s: LeasingSpecial, locale: Locale) => (locale === 'es' ? s.name_es : s.name_en);
export const specialDetails = (s: LeasingSpecial, locale: Locale) => (locale === 'es' ? s.details_es : s.details_en);
