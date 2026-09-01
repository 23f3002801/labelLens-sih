import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as scanService from '../services/scanService';
import { colors } from '../theme/colors';

// Replay mode: a list of captures the pipeline has already analyzed. Picking one loads the
// stored result straight onto the Result screen - no upload, no OCR, no SAM 2 unwrap - so a
// 360 scan that originally cost minutes of CPU renders instantly.

function ScanCard({ scan, onPress, disabled }) {
  const isVideo = scan.kind === 'video';
  const passed = scan.status === 'COMPLIANT';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center bg-white border border-ink-200 rounded-2xl p-3 mb-3 ${disabled ? 'opacity-50' : 'active:opacity-90'}`}
    >
      <View className="w-16 h-16 rounded-xl overflow-hidden bg-ink-100 mr-3">
        {scan.thumbnail_url ? (
          <Image source={{ uri: scan.thumbnail_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Ionicons name="image-outline" size={20} color={colors.ink400} />
          </View>
        )}
      </View>

      <View className="flex-1">
        <View className="flex-row items-center">
          <Ionicons name={isVideo ? 'sync' : 'camera'} size={14} color={colors.ink500} />
          <Text className="text-ink-900 text-base font-semibold ml-1.5">
            {isVideo ? `360° capture · ${scan.frame_count} faces` : 'Photo scan'}
          </Text>
        </View>
        <Text className="text-ink-500 text-xs mt-1">
          {scan.declaration_count} declarations read · {scan.violation_count} violations
        </Text>
      </View>

      <View className={`px-2.5 py-1 rounded-full ${passed ? 'bg-pass-50' : 'bg-fail-50'}`}>
        <Text className={`text-xs font-semibold ${passed ? 'text-pass-700' : 'text-fail-700'}`}>
          {Math.round(scan.compliance_score)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function DemoScansScreen({ navigation }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setScans(await scanService.listDemoScans());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openScan(demoId) {
    setOpeningId(demoId);
    try {
      const result = await scanService.getDemoScanResult(demoId);
      navigation.navigate('Result', { result });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-4">
        <Pressable onPress={() => navigation.goBack()} className="w-10 h-10 -ml-2 items-center justify-center">
          <Ionicons name="arrow-back" size={22} color={colors.ink700} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-2xl font-bold text-ink-900">Saved Scans</Text>
          <Text className="text-sm text-ink-500">Previously analyzed captures</Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary600} />
        </View>
      ) : (
        <FlatList
          data={scans}
          keyExtractor={(scan) => scan.demo_id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListHeaderComponent={
            error ? (
              <View className="bg-fail-50 rounded-xl p-3 mb-3">
                <Text className="text-fail-700 text-sm">{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            error ? null : (
              <View className="items-center mt-16 px-8">
                <Ionicons name="albums-outline" size={40} color={colors.ink400} />
                <Text className="text-ink-500 text-sm mt-3 text-center">
                  No analyzed scans yet. Capture a label and it will show up here.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <ScanCard scan={item} onPress={() => openScan(item.demo_id)} disabled={openingId !== null} />
          )}
        />
      )}
    </SafeAreaView>
  );
}
