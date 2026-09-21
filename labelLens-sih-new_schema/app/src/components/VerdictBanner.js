import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export default function VerdictBanner({ status }) {
  const isPass = status === 'pass';

  return (
    <View className={`flex-row items-center gap-3 rounded-2xl p-5 ${isPass ? 'bg-pass-50' : 'bg-fail-50'}`}>
      <Ionicons
        name={isPass ? 'checkmark-circle' : 'close-circle'}
        size={36}
        color={isPass ? colors.pass600 : colors.fail600}
      />
      <View className="flex-1">
        <Text className={`text-xl font-bold ${isPass ? 'text-pass-700' : 'text-fail-700'}`}>
          {isPass ? 'Label Compliant' : 'Violations Found'}
        </Text>
        <Text className={`text-sm mt-0.5 ${isPass ? 'text-pass-700' : 'text-fail-700'}`}>
          {isPass
            ? 'All mandatory declarations are present and correctly formatted.'
            : 'One or more mandatory declarations need attention.'}
        </Text>
      </View>
    </View>
  );
}
