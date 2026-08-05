/**
 * Internationalisation (SRS §7 Usability — Hindi support for a semi-literate user base).
 *
 * Every user-facing string lives here, never inline in a component. ESLint enforces it.
 *
 * Layout note: Devanagari runs taller and often longer than the English equivalent. Never
 * fix a button's height to exactly its English label — it will clip in Hindi.
 */

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
  lng: 'hi', // Hindi first — it is the majority language of the field user base.
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
