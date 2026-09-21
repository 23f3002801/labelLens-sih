import { useEffect, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/colors';

const GUIDE_WIDTH_RATIO = 0.82;
const GUIDE_ASPECT = 1.25; // height / width — most labels read taller than wide
const BRACKET = 28;

const DEFAULT_TIPS = [
  'Fit the label inside the frame',
  'Use bright, even lighting',
  'Avoid glare and reflections',
  'Fill the frame — text should be easy to read',
  'Hold steady for a sharp, in-focus shot',
];
const TIP_INTERVAL_MS = 2600;

export default function FrameGuideOverlay({ tips = DEFAULT_TIPS }) {
  const { width, height } = useWindowDimensions();
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (tips.length <= 1) return;
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % tips.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [tips]);

  const guideW = width * GUIDE_WIDTH_RATIO;
  const guideH = guideW * GUIDE_ASPECT;
  const guideX = (width - guideW) / 2;
  const guideY = (height - guideH) / 2 - 20;

  const corners = [
    { x: guideX, y: guideY, dx: 1, dy: 1 },
    { x: guideX + guideW, y: guideY, dx: -1, dy: 1 },
    { x: guideX, y: guideY + guideH, dx: 1, dy: -1 },
    { x: guideX + guideW, y: guideY + guideH, dx: -1, dy: -1 },
  ];

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width={width} height={height}>
        <Path
          d={`M0 0H${width}V${height}H0V0ZM${guideX} ${guideY}H${guideX + guideW}V${guideY + guideH}H${guideX}V${guideY}Z`}
          fill="rgba(15,23,42,0.55)"
          fillRule="evenodd"
        />
        {corners.map((c, i) => (
          <Path
            key={i}
            d={`M${c.x + c.dx * BRACKET} ${c.y} L${c.x} ${c.y} L${c.x} ${c.y + c.dy * BRACKET}`}
            stroke={colors.primary500}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </Svg>

      <View style={{ position: 'absolute', top: guideY - 48, width, alignItems: 'center' }}>
        <Text className="text-white text-base font-medium bg-black/30 px-4 py-2 rounded-full overflow-hidden">
          {tips[tipIndex]}
        </Text>
      </View>
    </View>
  );
}
