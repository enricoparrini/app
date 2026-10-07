import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { ChevronLeft } from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

export default function Preview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<{ uri: string; headers?: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const src = await api.reportHtmlUrl(id!);
        setSource(src);
      } catch (e: any) {
        setErr(e.message || "Impossibile caricare l'anteprima");
      }
    })();
  }, [id]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back-preview" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title}>Anteprima riepilogo</Text>
        <View style={{ width: 26 }} />
      </View>
      {err ? (
        <View style={styles.loader}>
          <Text style={{ color: colors.error }}>{err}</Text>
        </View>
      ) : !source ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <WebView
          testID="report-webview"
          source={source}
          style={{ flex: 1, backgroundColor: colors.surface }}
          originWhitelist={["*"]}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loader}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          )}
        />
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
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
});
