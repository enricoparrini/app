import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BarChart3, CheckCircle2, Plus, Settings as SettingsIcon } from "lucide-react-native";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/contexts/AuthContext";
import { colors } from "@/src/theme";
import { formatMoney, MONTHS_IT } from "@/src/utils/format";

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const cfgQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const blocksQuery = useQuery({
    queryKey: ["blocks"],
    queryFn: () => api.listBlocks(),
    enabled: !!cfgQuery.data?.config,
  });

  useFocusEffect(
    useCallback(() => {
      cfgQuery.refetch();
      blocksQuery.refetch();
    }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  );

  const cfg = cfgQuery.data?.config;

  if (cfgQuery.isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  if (!cfg) {
    return (
      <View style={[styles.loader, { paddingTop: insets.top }]}>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>Configurazione mancante</Text>
        <Pressable onPress={() => router.push("/setup")} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Configura</Text>
        </Pressable>
      </View>
    );
  }

  const blocks = blocksQuery.data?.blocks || [];
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const createCurrent = async () => {
    const { block } = await api.createBlock(curMonth, curYear);
    router.push(`/block/${block.block_id}`);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Ciao {cfg.parent1_name?.split(" ")[0] || ""}</Text>
          <Text style={styles.pageTitle}>Spese extra</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            testID="open-stats"
            onPress={() => router.push("/stats")}
            hitSlop={10}
            style={styles.iconBtn}
          >
            <BarChart3 color={colors.onSurface} size={22} />
          </Pressable>
          <Pressable
            testID="open-settings"
            onPress={() => router.push("/settings")}
            hitSlop={10}
            style={styles.iconBtn}
          >
            <SettingsIcon color={colors.onSurface} size={22} />
          </Pressable>
        </View>
      </View>

      {blocksQuery.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={(it) => it.block_id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 120,
            paddingTop: 8,
          }}
          refreshControl={
            <RefreshControl
              refreshing={blocksQuery.isFetching}
              onRefresh={() => blocksQuery.refetch()}
              tintColor={colors.brandPrimary}
            />
          }
          ListHeaderComponent={
            <Pressable
              testID="create-current-month"
              onPress={createCurrent}
              style={styles.cta}
            >
              <View>
                <Text style={styles.ctaTitle}>Mese corrente</Text>
                <Text style={styles.ctaSub}>
                  Spese extra {MONTHS_IT[curMonth - 1]} &apos;{String(curYear).slice(-2)}
                </Text>
              </View>
              <View style={styles.ctaArrow}>
                <Plus color={colors.onBrandPrimary} size={22} />
              </View>
            </Pressable>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nessun blocco ancora</Text>
              <Text style={styles.emptyText}>Tocca &quot;Mese corrente&quot; per iniziare.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`block-${item.block_id}`}
              onPress={() => router.push(`/block/${item.block_id}`)}
              style={[styles.card, item.status === "closed" && styles.cardClosed]}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>{item.label}</Text>
                  {item.status === "closed" && (
                    <View style={styles.badge}>
                      <CheckCircle2 color={colors.onSuccess} size={12} />
                      <Text style={styles.badgeText}>Chiuso</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardSub}>
                  {item.expenses.length} spes{item.expenses.length === 1 ? "a" : "e"} ·{" "}
                  {formatMoney(item.totals.total)}
                </Text>
              </View>
              <View style={styles.saldoBox}>
                <Text style={styles.saldoLabel}>Saldo</Text>
                <Text
                  style={[
                    styles.saldoValue,
                    { color: Math.abs(item.totals.saldo) < 0.01 ? colors.muted : colors.brandPrimary },
                  ]}
                >
                  {formatMoney(Math.abs(item.totals.saldo))}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="fab-add-current"
        onPress={createCurrent}
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
      >
        <Plus color={colors.onBrandPrimary} size={28} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hello: { color: colors.muted, fontSize: 14 },
  pageTitle: { color: colors.onSurface, fontSize: 28, fontWeight: "700" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  cta: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctaTitle: { color: colors.brandPrimary, fontSize: 13, fontWeight: "600" },
  ctaSub: { color: colors.onSurface, fontSize: 20, fontWeight: "700", marginTop: 4 },
  ctaArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardClosed: { opacity: 0.75 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  cardSub: { color: colors.muted, fontSize: 13, marginTop: 4 },
  badge: {
    backgroundColor: colors.success,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badgeText: { color: colors.onSuccess, fontSize: 10, fontWeight: "600" },
  saldoBox: { alignItems: "flex-end" },
  saldoLabel: { color: colors.muted, fontSize: 11 },
  saldoValue: { fontSize: 16, fontWeight: "700", marginTop: 2 },
  empty: { alignItems: "center", marginTop: 40 },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  emptyText: { color: colors.muted, marginTop: 4 },
  fab: {
    position: "absolute",
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "600" },
});
