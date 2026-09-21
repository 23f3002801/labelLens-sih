import { useState } from 'react';
import { View, Text, FlatList, useWindowDimensions } from 'react-native';
import EvidenceImage from './EvidenceImage';

// Horizontal padding the Result screen puts around its content — used only as the first-render
// guess for the page width, before onLayout reports the real one.
const SCREEN_PADDING = 20;

const DOT_SIZE = 6;
const ACTIVE_DOT_WIDTH = 18;

// A 360 video scan comes back as several label faces (front/back/side), each with its own
// evidence image, its own declarations and its own source pixel dimensions. This pages through
// them; a single-image result (any photo scan) renders as a bare EvidenceImage with no chrome.
export default function EvidenceCarousel({ frames }) {
  const { width: windowWidth } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(windowWidth - SCREEN_PADDING * 2);
  const [index, setIndex] = useState(0);

  if (frames.length <= 1) {
    const frame = frames[0];
    return (
      <EvidenceImage uri={frame?.evidenceImageUri} declarations={frame?.declarations ?? []} />
    );
  }

  return (
    <View onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
      <FlatList
        data={frames}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(frame, i) => frame.scanId ?? String(i)}
        getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(pageWidth, 1)))
        }
        renderItem={({ item }) => (
          // Boxes are normalized against the frame they were measured on, so every page draws
          // strictly from its own declarations — never from the merged product-level list.
          <View style={{ width: pageWidth }}>
            <EvidenceImage uri={item.evidenceImageUri} declarations={item.declarations ?? []} />
          </View>
        )}
      />

      <View className="flex-row items-center justify-center gap-2 mt-3">
        {frames.map((frame, i) => (
          <View
            key={frame.scanId ?? i}
            className={`rounded-full ${i === index ? 'bg-primary-600' : 'bg-ink-200'}`}
            style={{ width: i === index ? ACTIVE_DOT_WIDTH : DOT_SIZE, height: DOT_SIZE }}
          />
        ))}
      </View>

      <Text className="text-xs text-ink-500 text-center mt-2">
        Label face {index + 1} of {frames.length}
      </Text>
    </View>
  );
}
