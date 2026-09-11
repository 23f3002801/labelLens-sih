import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import RotationRingOverlay from '../components/RotationRingOverlay';
import CaptureButton from '../components/CaptureButton';

// The backend's label extractor samples keyframes evenly across the whole clip (up to 15 of
// them) and only keeps a face if it turns up in 2+ of those keyframes - a single fast spin
// gives each face just one or two keyframes, so it gets discarded as noise. A slow ~10-12s
// rotation gives every face several keyframes' worth of dwell time to survive that filter.
const MAX_DURATION_SEC = 15;
const MIN_DURATION_MS = 8000;

export default function VideoCaptureScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [recording, setRecording] = useState(false);
  const [canStop, setCanStop] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      setElapsedSec(Math.min(MAX_DURATION_SEC, Math.round((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

  if (!permission) {
    return <View className="flex-1 bg-black" />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Ionicons name="videocam-outline" size={48} color="#64748B" />
        <Text className="text-lg font-semibold text-ink-800 mt-4 text-center">Camera access needed</Text>
        <Text className="text-sm text-ink-500 mt-2 text-center">
          ALMAC needs your camera to record the 360° scan.
        </Text>
        <Pressable onPress={requestPermission} className="mt-6 bg-primary-600 rounded-xl px-6 py-3 active:opacity-90">
          <Text className="text-white font-semibold">Grant permission</Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} className="mt-3 px-6 py-3">
          <Text className="text-ink-500 font-medium">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  async function handlePress() {
    if (!cameraRef.current) return;

    if (recording) {
      if (!canStop) return;
      cameraRef.current.stopRecording();
      return;
    }

    setRecording(true);
    setCanStop(false);
    progress.value = 0;
    progress.value = withTiming(1, { duration: MAX_DURATION_SEC * 1000 });
    setTimeout(() => setCanStop(true), MIN_DURATION_MS);

    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION_SEC });
      setRecording(false);
      if (video?.uri) {
        navigation.replace('Processing', { kind: 'video', fileUri: video.uri });
      }
    } catch (err) {
      setRecording(false);
    }
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" mode="video" mute />

      <SafeAreaView className="absolute top-0 left-0 right-0" edges={['top']}>
        <Pressable
          onPress={() => navigation.goBack()}
          className="ml-4 mt-2 w-10 h-10 rounded-full bg-black/40 items-center justify-center"
        >
          <Ionicons name="close" size={22} color="white" />
        </Pressable>
        <View className="items-center mt-4 px-10">
          <Text className="text-white text-base font-medium bg-black/30 px-4 py-2 rounded-full overflow-hidden text-center">
            {recording
              ? 'Slowly rotate a full 360° - keep it centered, away from the edges'
              : 'Leave space around the product, then start recording'}
          </Text>
        </View>
      </SafeAreaView>

      <SafeAreaView className="absolute bottom-0 left-0 right-0 items-center pb-8" edges={['bottom']}>
        <View className="items-center justify-center" style={{ width: 104, height: 104 }}>
          <RotationRingOverlay progress={progress} size={104} strokeWidth={6} />
          <View className="absolute">
            <CaptureButton onPress={handlePress} variant="video" recording={recording} />
          </View>
        </View>
        <Text className="text-white/80 text-xs mt-3">
          {recording
            ? `${elapsedSec}s / ${MAX_DURATION_SEC}s${canStop ? ' · Tap to stop' : ' · Keep rotating…'}`
            : 'Tap to start'}
        </Text>
      </SafeAreaView>
    </View>
  );
}
