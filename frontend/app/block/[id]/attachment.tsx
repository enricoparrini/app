import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ImageView from "react-native-image-viewing";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { ChevronLeft, Share2, FileText } from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

export default function AttachmentView() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<string | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getAttachment(id!, eid!);
        setData(r.data);
        setMime(r.mime);
        setName(r.name);
      } catch (e: any) {
        setErr(e.message || "Impossibile caricare l'allegato");
      }
    })();
  }, [id, eid]);

  const isImage = !!mime && mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  const images = useMemo(
    () =>
      isImage && data
        ? [{ uri: `data:${mime};base64,${data}` }]
        : [],
    [isImage, data, mime]
  );

  const sharePdf = async () => {
    if (!data || !mime) return;
    try {
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
      const path = `${dir}${(name || "allegato.pdf").replace(/[^A-Za-z0-9._-]+/g, "_")}`;
      await FileSystem.writeAsStringAsync(path, data, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(path, {
          mimeType: mime,
          dialogTitle: name || "Allegato",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Allegato salvato", `Il file è stato salvato in: ${path}`);
      }
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile condividere");
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back-attachment" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {name || "Allegato"}
        </Text>
        {isPdf && data ? (
          <Pressable testID="share-pdf" onPress={sharePdf} hitSlop={10}>
            <Share2 color={colors.brandPrimary} size={22} />
          </Pressable>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      {err ? (
        <View style={styles.loader}>
          <Text style={{ color: colors.error }}>{err}</Text>
        </View>
      ) : !data ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : isImage ? (
        <ImageView
          images={images}
          imageIndex={0}
          visible
          onRequestClose={() => router.back()}
          swipeToCloseEnabled={false}
          doubleTapToZoomEnabled
          presentationStyle="overFullScreen"
        />
      ) : isPdf ? (
        <View style={styles.pdfBox}>
          <View style={styles.pdfIcon}>
            <FileText color={colors.onBrandPrimary} size={48} />
          </View>
          <Text style={styles.pdfTitle}>{name}</Text>
          <Text style={styles.pdfHint}>
            I PDF si aprono con l&apos;app del tuo dispositivo. Tocca &quot;Apri&quot; per visualizzare o condividere.
          </Text>
          <Pressable testID="open-pdf" onPress={sharePdf} style={styles.pdfBtn}>
            <Share2 color={colors.onBrandPrimary} size={18} />
            <Text style={styles.pdfBtnText}>Apri / Condividi PDF</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.loader}>
          <Text style={{ color: colors.muted }}>Tipo di allegato non supportato</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onSurface,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  pdfBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  pdfIcon: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  pdfHint: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 18 },
  pdfBtn: {
    marginTop: 16,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfBtnText: { color: colors.onBrandPrimary, fontWeight: "600" },
});
