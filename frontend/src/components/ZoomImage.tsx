import ImageView from "react-native-image-viewing";

type Props = { uri: string; onClose: () => void };

export default function ZoomImage({ uri, onClose }: Props) {
  return (
    <ImageView
      images={[{ uri }]}
      imageIndex={0}
      visible
      onRequestClose={onClose}
      swipeToCloseEnabled={false}
      doubleTapToZoomEnabled
      presentationStyle="overFullScreen"
    />
  );
}
