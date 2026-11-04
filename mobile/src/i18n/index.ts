/**
 * Internationalisation (SRS §7 Usability — Hindi support for a semi-literate user base).
 *
 * Every user-facing string lives here, never inline in a component. ESLint enforces it.
 *
 * Layout note: Devanagari runs taller and often longer than the English equivalent. Never
 * fix a button's height to exactly its English label — it will clip in Hindi.
 */

// Must come before i18next. Hermes ships without a complete Intl implementation, so
// i18next finds no Intl.PluralRules, warns, and silently falls back to its v3 plural
// format — under which the `_one` / `_other` keys in these files do not resolve at all.
// Node has Intl, so this fails only on a device and never in the test suite: the "N
// attempts left" line would simply come out wrong in front of a Mait.
import 'intl-pluralrules';

import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import hi from './hi.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  // English by default for now, switchable to Hindi from the toggle in the hero.
  //
  // Worth revisiting before field rollout: SRS §7 asks for Hindi support precisely because
  // the user base is semi-literate and Hindi-speaking, and a Mait who cannot read the
  // default has to find the toggle before they can find anything else.
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
  // Initialise synchronously. Left async, i18next resolves after the first render and
  // useTranslation re-renders every consumer — which in tests lands outside act() and
  // reports as a warning on components that did nothing wrong.
  initImmediate: false,
  react: { useSuspense: false },
});

export default i18n;

const DEVANAGARI = /[ऀ-ॿ]/;

/** True when a string contains Hindi (Devanagari) letters. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

/**
 * The language the Mait last chose, kept on the handset.
 *
 * Without it every launch started in English: a Mait who picked हिन्दी on the sign-in screen
 * got English back the next morning, and had to find the switch again in a language they had
 * already said they do not read.
 */
const LANGUAGE_KEY = 'maitai.language.v1';

i18n.on('languageChanged', lng => {
  AsyncStorage.setItem(LANGUAGE_KEY, lng).catch(() => undefined);
});

/** Put back the saved language. Called once at launch, before the first screen is drawn. */
export async function restoreLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some(lang => lang.code === saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // Unreadable storage leaves English, which is where a first launch starts anyway.
  }
}
