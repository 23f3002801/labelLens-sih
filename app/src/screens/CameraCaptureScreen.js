import { useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import FrameGuideOverlay from '../components/FrameGuideOverlay';
import CaptureButton from '../components/CaptureButton';

export default function CameraCaptureScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);

  if (!permission) {
    return <View className="flex-1 bg-black" />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Ionicons name="camera-outline" size={48} color="#64748B" />
        <Text className="text-lg font-semibold text-ink-800 mt-4 text-center">Camera access needed</Text>
        <Text className="text-sm text-ink-500 mt-2 text-center">
          ALMAC needs your camera to scan product labels.
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

  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      navigation.replace('Processing', { kind: 'photo', fileUri: photo.uri });
    } catch (err) {
      setCapturing(false);
    }
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" mode="picture" />
      <FrameGuideOverlay />

      <SafeAreaView className="absolute top-0 left-0 right-0" edges={['top']}>
        <Pressable
          onPress={() => navigation.goBack()}
          className="ml-4 mt-2 w-10 h-10 rounded-full bg-black/40 items-center justify-center"
        >
          <Ionicons name="close" size={22} color="white" />
        </Pressable>
      </SafeAreaView>

      <SafeAreaView className="absolute bottom-0 left-0 right-0 items-center pb-8" edges={['bottom']}>
        <CaptureButton onPress={handleCapture} variant="photo" />
      </SafeAreaView>
    </View>
  );
}
