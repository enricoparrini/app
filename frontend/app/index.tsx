import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { formatMoney, MONTHS_IT } from "@/src/utils/format";

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

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

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickMonth, setPickMonth] = useState(curMonth);
  const [pickYear, setPickYear] = useState(curYear);
  const [creating, setCreating] = useState(false);

  const years = useMemo(() => [curYear - 1, curYear, curYear + 1], [curYear]);

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

  const createMonth = async (m: number, y: number) => {
    setCreating(true);
    try {
      const { block } = await api.createBlock(m, y);
      setPickerOpen(false);
      router.push(`/block/${block.block_id}`);
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile creare il blocco");
    } finally {
      setCreating(false);
    }
  };

  const createCurrent = () => createMonth(curMonth, curYear);

  const openPickerForNext = () => {
    // default = mese successivo rispetto a oggi
    const nextM = curMonth === 12 ? 1 : curMonth + 1;
    const nextY = curMonth === 12 ? curYear + 1 : curYear;
    setPickMonth(nextM);
    setPickYear(nextY);
    setPickerOpen(true);
  };

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
            await api.deleteBlock(block.block_id);
            qc.invalidateQueries({ queryKey: ["blocks"] });
          },
        },
      ]
    );
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
            paddingBottom: insets.bottom + 160,
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
            <View style={{ gap: 12, marginBottom: 16 }}>
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
              <Pressable
                testID="open-month-picker"
                onPress={openPickerForNext}
                style={styles.ctaOutline}
              >
                <CalendarPlus color={colors.brandPrimary} size={18} />
                <Text style={styles.ctaOutlineText}>Scegli un altro mese</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nessun blocco ancora</Text>
              <Text style={styles.emptyText}>Tocca &quot;Mese corrente&quot; per iniziare.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, item.status === "closed" && styles.cardClosed]}>
              <Pressable
                testID={`block-${item.block_id}`}
                onPress={() => router.push(`/block/${item.block_id}`)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
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
                      {
                        color:
                          Math.abs(item.totals.saldo) < 0.01
                            ? colors.muted
                            : colors.brandPrimary,
                      },
                    ]}
                  >
                    {formatMoney(Math.abs(item.totals.saldo))}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                testID={`delete-block-${item.block_id}`}
                onPress={() => confirmDelete(item)}
                hitSlop={8}
                style={styles.cardDelete}
              >
                <Trash2 color={colors.error} size={18} />
              </Pressable>
            </View>
          )}
        />
      )}

      <Pressable
        testID="fab-add"
        onPress={openPickerForNext}
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
      >
        <Plus color={colors.onBrandPrimary} size={28} />
      </Pressable>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.modalBg} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuovo blocco mensile</Text>
              <Pressable
                testID="close-picker"
                onPress={() => setPickerOpen(false)}
                hitSlop={8}
              >
                <X color={colors.onSurface} size={22} />
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Mese</Text>
            <View style={styles.monthsGrid}>
              {MONTHS_IT.map((n, i) => {
                const m = i + 1;
                const selected = pickMonth === m;
                return (
                  <Pressable
                    key={m}
                    testID={`pick-month-${m}`}
                    onPress={() => setPickMonth(m)}
                    style={[styles.monthChip, selected && styles.monthChipActive]}
                  >
                    <Text
                      style={[
                        styles.monthChipText,
                        selected && styles.monthChipTextActive,
                      ]}
                    >
                      {n.slice(0, 3)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalLabel}>Anno</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {years.map((y) => {
                const selected = pickYear === y;
                return (
                  <Pressable
                    key={y}
                    testID={`pick-year-${y}`}
                    onPress={() => setPickYear(y)}
                    style={[styles.yearChip, selected && styles.yearChipActive]}
                  >
                    <Text
                      style={[
                        styles.yearChipText,
                        selected && styles.yearChipTextActive,
                      ]}
                    >
                      {y}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              testID="confirm-pick-month"
              onPress={() => createMonth(pickMonth, pickYear)}
              disabled={creating}
              style={styles.modalBtn}
            >
              {creating ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.modalBtnText}>
                  Crea · {MONTHS_IT[pickMonth - 1]} &apos;{String(pickYear).slice(-2)}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  ctaOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderStyle: "dashed",
  },
  ctaOutlineText: { color: colors.brandPrimary, fontWeight: "600" },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardClosed: { opacity: 0.85 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  cardSub: { color: colors.muted, fontSize: 13, marginTop: 4 },
  cardDelete: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
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

  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700" },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  monthsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  monthChip: {
    width: "22%",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  monthChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  monthChipText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  monthChipTextActive: { color: colors.onBrandPrimary },
  yearChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  yearChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  yearChipText: { color: colors.onSurface, fontWeight: "600" },
  yearChipTextActive: { color: colors.onBrandPrimary },
  modalBtn: {
    marginTop: 10,
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
});
