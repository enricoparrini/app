import { Image, StyleSheet } from "react-native";

// react-native-image-viewing non supporta il web: anteprima semplice
type Props = { uri: string; onClose: () => void };

export default function ZoomImage({ uri }: Props) {
  return <Image source={{ uri }} style={styles.img} resizeMode="contain" />;
}

const styles = StyleSheet.create({ img: { flex: 1, width: "100%" } });
