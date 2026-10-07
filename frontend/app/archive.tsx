import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Trash2 } from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { formatMoney } from "@/src/utils/format";

export default function Archive() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["blocks"],
    queryFn: () => api.listBlocks(),
  });
  const blocks = data?.blocks || [];

  const confirmDelete = (block: any) => {
    Alert.alert(
      "Elimina blocco",
      `${block.label}\n\nVerranno eliminate tutte le registrazioni e andranno perse. Confermi?`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Elimina",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteBlock(block.block_id);
              qc.invalidateQueries({ queryKey: ["blocks"] });
            } catch (e: any) {
              Alert.alert("Errore", e.message || "Impossibile eliminare");
            }
          },
        },
      ]
    );
  };

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
              Nessun blocco in archivio.
            </Text>
          ) : (
            blocks.map((b: any) => (
              <View key={b.block_id} style={styles.card}>
                <Pressable
                  testID={`archive-${b.block_id}`}
                  onPress={() => router.push(`/block/${b.block_id}`)}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.cardTitle}>{b.label}</Text>
                      <Text
                        style={[
                          styles.statusPill,
                          b.status === "closed" ? styles.pillClosed : styles.pillOpen,
                        ]}
                      >
                        {b.status === "closed" ? "Chiuso" : "Aperto"}
                      </Text>
                    </View>
                    <Text style={styles.cardSub}>
                      {b.expenses.length} spese · {formatMoney(b.totals.total)}
                    </Text>
                  </View>
                  <Text style={styles.saldo}>{formatMoney(Math.abs(b.totals.saldo))}</Text>
                </Pressable>
                <Pressable
                  testID={`archive-delete-${b.block_id}`}
                  onPress={() => confirmDelete(b)}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Trash2 color={colors.error} size={18} />
                </Pressable>
              </View>
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
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  cardSub: { color: colors.muted, marginTop: 2, fontSize: 12 },
  saldo: { color: colors.brandPrimary, fontWeight: "700", marginRight: 8 },
  statusPill: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  pillClosed: { backgroundColor: colors.success, color: colors.onSuccess },
  pillOpen: { backgroundColor: colors.brandSecondary, color: colors.onBrandSecondary },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
});
