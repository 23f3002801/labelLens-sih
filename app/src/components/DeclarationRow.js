import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

const STATUS_META = {
  ok: { icon: 'checkmark-circle', color: colors.pass600, label: 'Compliant' },
  wrong_format: { icon: 'alert-circle', color: colors.warn600, label: 'Wrong format' },
  too_small: { icon: 'resize-outline', color: colors.warn600, label: 'Text too small' },
  not_grouped: { icon: 'layers-outline', color: colors.warn600, label: 'Not grouped' },
  missing: { icon: 'close-circle', color: colors.fail600, label: 'Missing' },
};

export default function DeclarationRow({ declaration }) {
  const meta = STATUS_META[declaration.status] ?? STATUS_META.missing;

  return (
    <View className="flex-row items-start gap-3 py-3 border-b border-ink-100">
      <Ionicons name={meta.icon} size={22} color={meta.color} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-base font-semibold text-ink-800 flex-1">{declaration.label}</Text>
          <Text className="text-xs font-medium" style={{ color: meta.color }}>
            {meta.label}
          </Text>
        </View>
        {declaration.message ? (
          <Text className="text-sm text-ink-500 mt-1">{declaration.message}</Text>
        ) : null}
      </View>
    </View>
  );
}
