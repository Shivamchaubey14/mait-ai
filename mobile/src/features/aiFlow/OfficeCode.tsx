/**
 * "SMS not reaching her? Ask the office to call her" — at every step that sends the farmer a code.
 *
 * The farmer check and both payment confirmations send a code to her phone, and when the SMS
 * gateway is not delivering, a capture stops at that step with a farmer and an animal waiting.
 * This asks the office instead: they generate a code on the portal and phone *her*, on the
 * number on her record, and she tells the Mait what they read out — exactly as she would have
 * read the SMS. The Mait is never told the code by anyone but her, which is what keeps it her
 * consent.
 *
 * Offered only once the SMS has been tried (the server refuses before), and it goes into the
 * same box the SMS code goes in: nothing else about the step changes.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

export function OfficeCodeAsk({
  asked,
  busy = false,
  onAsk,
  sentTo,
  testID = 'office-code',
}: {
  asked: boolean;
  busy?: boolean;
  onAsk: () => void;
  /** Her number as the SMS step showed it, masked — the one the office will ring. */
  sentTo: string | null;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (asked) {
    return (
      <View style={styles.asked} testID={`${testID}-asked`}>
        <View style={styles.icon}>
          <Ionicons name="call-outline" size={18} color={colors.primaryDark} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{t('aiFlow.officeAskedTitle')}</Text>
          <Text style={styles.text}>
            {t('aiFlow.officeAskedBody', { mobile: sentTo ?? t('aiFlow.herNumber') })}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      onPress={onAsk}
      disabled={busy}
      style={styles.link}
      testID={`${testID}-ask`}
    >
      {busy ? (
        <ActivityIndicator color={colors.primaryDark} />
      ) : (
        <Ionicons name="help-buoy-outline" size={16} color={colors.primaryDark} />
      )}
      <Text style={styles.linkLabel}>{t('aiFlow.officeAsk')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
  },
  linkLabel: { ...typography.label, color: colors.primaryDark },
  // Green: help on its way, not a warning about the network.
  asked: {
    flexDirection: 'row',
    gap: spacing[3],
    marginVertical: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  body: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.ink },
  text: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
