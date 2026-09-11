import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as scanService from '../services/scanService';
import { colors } from '../theme/colors';

const STAGES = {
  photo: ['Uploading photo…', 'Analyzing label…', 'Checking compliance…'],
  video: ['Uploading video…', 'Extracting label frames…', 'Analyzing label…', 'Checking compliance…'],
};

export default function ProcessingScreen({ route, navigation }) {
  const { kind, fileUri } = route.params;
  const stages = STAGES[kind] ?? STAGES.photo;
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState(null);
  const [errorDetail, setErrorDetail] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setErrorDetail(null);
    setStageIndex(0);

    const stageTimer = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, stages.length - 1));
    }, 900);

    async function run() {
      try {
        // A photo submits to one scan; a 360 video submits to one scan per extracted label
        // face. Both land on the Result screen - the multi-face result just carries a `frames`
        // array alongside the same top-level status/declarations a single scan has.
        const submit = kind === 'video' ? scanService.submitVideoScan : scanService.submitPhotoScan;
        const submission = await submit(fileUri);
        const result = submission.frames
          ? await scanService.getMultiScanResult(submission.frames)
          : await scanService.getScanResult(submission.scanId);
        if (!cancelled) navigation.replace('Result', { result });
      } catch (err) {
        console.error('[ProcessingScreen] scan failed:', err);
        if (!cancelled) {
          setError('Something went wrong while analyzing the label.');
          setErrorDetail(err?.message || String(err));
        }
      } finally {
        clearInterval(stageTimer);
      }
    }

    run();
    return () => {
      cancelled = true;
      clearInterval(stageTimer);
    };
  }, [attempt, kind, fileUri]);

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Ionicons name="alert-circle-outline" size={48} color={colors.fail600} />
        <Text className="text-lg font-semibold text-ink-800 mt-4 text-center">{error}</Text>
        {errorDetail ? (
          <Text className="text-xs text-ink-400 mt-2 text-center">{errorDetail}</Text>
        ) : null}
        <Pressable
          onPress={() => setAttempt((a) => a + 1)}
          className="mt-6 bg-primary-600 rounded-xl px-6 py-3 active:opacity-90"
        >
          <Text className="text-white font-semibold">Try again</Text>
        </Pressable>
        <Pressable onPress={() => navigation.popToTop()} className="mt-3 px-6 py-3">
          <Text className="text-ink-500 font-medium">Back to home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <ActivityIndicator size="large" color={colors.primary600} />
      <Text className="text-lg font-semibold text-ink-800 mt-6 text-center">{stages[stageIndex]}</Text>
      <Text className="text-sm text-ink-400 mt-2 text-center">This usually takes a few seconds</Text>
    </SafeAreaView>
  );
}
