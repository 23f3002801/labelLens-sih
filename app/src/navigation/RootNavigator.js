import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import CameraCaptureScreen from '../screens/CameraCaptureScreen';
import VideoCaptureScreen from '../screens/VideoCaptureScreen';
import ProcessingScreen from '../screens/ProcessingScreen';
import DemoScansScreen from '../screens/DemoScansScreen';
import ResultScreen from '../screens/ResultScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="CameraCapture" component={CameraCaptureScreen} />
        <Stack.Screen name="VideoCapture" component={VideoCaptureScreen} />
        <Stack.Screen name="DemoScans" component={DemoScansScreen} />
        <Stack.Screen name="Processing" component={ProcessingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Result" component={ResultScreen} options={{ gestureEnabled: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
