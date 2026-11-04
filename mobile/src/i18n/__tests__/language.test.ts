/**
 * The chosen language outlives the app.
 *
 * Every launch used to start in English, so a Mait who picked हिन्दी on the sign-in screen got
 * English back the next time the app opened.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n, { restoreLanguage } from '@/i18n';

const KEY = 'maitai.language.v1';

afterEach(async () => {
  await i18n.changeLanguage('en');
  await AsyncStorage.removeItem(KEY);
});

describe('the language setting', () => {
  it('is saved on the handset when it changes', async () => {
    await i18n.changeLanguage('hi');
    expect(await AsyncStorage.getItem(KEY)).toBe('hi');
  });

  it('is put back at launch', async () => {
    await AsyncStorage.setItem(KEY, 'hi');
    await i18n.changeLanguage('en');
    // changeLanguage saved 'en' over it; put the launch-time value back.
    await AsyncStorage.setItem(KEY, 'hi');

    await restoreLanguage();
    expect(i18n.language).toBe('hi');
  });

  it('ignores anything that is not a language the app has', async () => {
    await AsyncStorage.setItem(KEY, 'fr');
    await restoreLanguage();
    expect(i18n.language).toBe('en');
  });
});
