import { Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { colors } from '../theme/colors';

// Shared shutter button for both capture screens. In "video" mode the inner shape morphs from a
// circle to a rounded square while recording, mirroring the record/stop affordance native camera
// apps use so it's obvious at a glance whether it's currently recording.
export default function CaptureButton({ onPress, variant = 'photo', recording = false }) {
  const press = useSharedValue(1);
  const outerStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const innerStyle = useAnimatedStyle(() => ({
    borderRadius: withTiming(recording ? 10 : 32, { duration: 200 }),
    width: withTiming(recording ? 32 : 64, { duration: 200 }),
    height: withTiming(recording ? 32 : 64, { duration: 200 }),
    backgroundColor: variant === 'video' ? colors.fail500 : colors.ink50,
  }));

  return (
    <Animated.View style={outerStyle}>
      <Pressable
        onPressIn={() => {
          press.value = withTiming(0.9, { duration: 100 });
        }}
        onPressOut={() => {
          press.value = withTiming(1, { duration: 150 });
        }}
        onPress={onPress}
        className="w-20 h-20 rounded-full items-center justify-center border-4 border-white"
        style={{ shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, elevation: 8 }}
      >
        <Animated.View style={innerStyle} />
      </Pressable>
    </Animated.View>
  );
}
