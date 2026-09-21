import { View, Image, Text } from 'react-native';
import { colors } from '../theme/colors';

const BOX_COLOR = {
  wrong_format: colors.warn600,
  too_small: colors.warn600,
  not_grouped: colors.warn600,
  missing: colors.fail600,
};

export default function EvidenceImage({ uri, declarations }) {
  const flagged = declarations.filter((d) => d.boundingBox && d.status !== 'ok');

  return (
    <View
      className="rounded-2xl overflow-hidden bg-ink-100"
      style={{ aspectRatio: 3 / 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, elevation: 4 }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="text-ink-400 text-sm">Evidence frame not available yet</Text>
        </View>
      )}

      {flagged.map((d) => {
        const { x, y, width, height } = d.boundingBox;
        const color = BOX_COLOR[d.status] ?? colors.warn600;
        return (
          <View
            key={d.type}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              borderWidth: 2,
              borderColor: color,
              borderRadius: 6,
              backgroundColor: `${color}22`,
            }}
          />
        );
      })}
    </View>
  );
}
