import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { formatMoney } from "@/src/utils/format";

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useQuery({
    queryKey: ["blocks"],
    queryFn: () => api.listBlocks(),
  });
  const blocks = (data?.blocks || []).filter((b: any) => b.status === "closed");

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title}>Archivio</Text>
        <View style={{ width: 26 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 10 }}
        >
          {blocks.length === 0 ? (
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
              Nessun blocco chiuso ancora.
            </Text>
          ) : (
            blocks.map((b: any) => (
              <Pressable
                key={b.block_id}
                testID={`archive-${b.block_id}`}
                onPress={() => router.push(`/block/${b.block_id}`)}
                style={styles.card}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{b.label}</Text>
                  <Text style={styles.cardSub}>
                    {b.expenses.length} spese · {formatMoney(b.totals.total)}
                  </Text>
                </View>
                <Text style={styles.saldo}>{formatMoney(Math.abs(b.totals.saldo))}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
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
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  cardSub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  saldo: { color: colors.brandPrimary, fontWeight: "700" },
});
