import { View, Text, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 justify-center">
        <View className="items-center mb-12">
          <View
            className="w-20 h-20 rounded-3xl bg-primary-600 items-center justify-center mb-4"
            style={{ shadowColor: '#4F46E5', shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 }}
          >
            <Image
              source={require('../../assets/android-icon-foreground.png')}
              style={{ width: 56, height: 56 }}
              resizeMode="contain"
            />
          </View>
          <Text className="text-3xl font-bold text-ink-900">ALMAC</Text>
          <Text className="text-base text-ink-500 mt-2 text-center">
            Scan a product label to check Legal Metrology compliance
          </Text>
        </View>

        <View className="gap-4">
          <Pressable
            onPress={() => navigation.navigate('CameraCapture')}
            className="flex-row items-center bg-primary-600 rounded-2xl p-5 active:opacity-90"
          >
            <View className="w-12 h-12 rounded-xl bg-white/20 items-center justify-center mr-4">
              <Ionicons name="camera" size={24} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-white text-lg font-semibold">Scan Photo</Text>
              <Text className="text-primary-100 text-sm">Quick single-photo scan</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="white" />
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('VideoCapture')}
            className="flex-row items-center bg-white border border-ink-200 rounded-2xl p-5 active:opacity-90"
          >
            <View className="w-12 h-12 rounded-xl bg-primary-50 items-center justify-center mr-4">
              <Ionicons name="sync" size={24} color="#4F46E5" />
            </View>
            <View className="flex-1">
              <Text className="text-ink-900 text-lg font-semibold">Scan 360° Video</Text>
              <Text className="text-ink-500 text-sm">Best for cans & cylindrical packs</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#334155" />
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('DemoScans')}
            className="flex-row items-center bg-white border border-ink-200 rounded-2xl p-5 active:opacity-90"
          >
            <View className="w-12 h-12 rounded-xl bg-primary-50 items-center justify-center mr-4">
              <Ionicons name="albums" size={24} color="#4F46E5" />
            </View>
            <View className="flex-1">
              <Text className="text-ink-900 text-lg font-semibold">Saved Scans</Text>
              <Text className="text-ink-500 text-sm">Open a previously analyzed capture</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#334155" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
