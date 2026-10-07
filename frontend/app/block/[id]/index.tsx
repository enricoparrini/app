import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Plus, Paperclip, Pencil, Trash2, Lock, Send } from "lucide-react-native";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/contexts/AuthContext";
import { colors } from "@/src/theme";
import { formatDateIt, formatMoney } from "@/src/utils/format";
import { useEffect, useState } from "react";

export default function BlockDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConfig().then((r) => setCfg(r.config));
  }, []);

  const q = useQuery({
    queryKey: ["block", id],
    queryFn: () => api.getBlock(id!),
    enabled: !!id,
  });

  if (q.isLoading || !cfg) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  if (!q.data?.block) {
    return (
      <View style={styles.loader}>
        <Text>Blocco non trovato</Text>
      </View>
    );
  }

  const b = q.data.block;
  const closed = b.status === "closed";
  const totals = b.totals;
  const saldo = totals.saldo;
  const saldoLabel =
    Math.abs(saldo) < 0.01
      ? "Nessun saldo"
      : saldo > 0
      ? `${cfg.parent2_name} deve a te`
      : `Tu devi a ${cfg.parent2_name}`;

  const deleteExpense = (expId: string) => {
    Alert.alert("Elimina spesa", "Confermi?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina",
        style: "destructive",
        onPress: async () => {
          await api.deleteExpense(id!, expId);
          qc.invalidateQueries({ queryKey: ["block", id] });
          qc.invalidateQueries({ queryKey: ["blocks"] });
        },
      },
    ]);
  };

  const resend = async () => {
    setBusy(true);
    try {
      await api.resendEmail(id!);
      Alert.alert("Email inviata", "Riepilogo re-inviato al genitore 1.");
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Invio fallito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back-block" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {b.label}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={b.expenses}
        keyExtractor={(e: any) => e.expense_id}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 160, gap: 10 }}
        ListHeaderComponent={
          <View>
            <View style={styles.saldoCard}>
              <Text style={styles.saldoCardLabel}>{saldoLabel}</Text>
              <Text style={styles.saldoCardValue}>{formatMoney(Math.abs(saldo))}</Text>
              <View style={styles.saldoRow}>
                <View style={styles.saldoCol}>
                  <Text style={styles.colLabel}>Totale</Text>
                  <Text style={styles.colValue}>{formatMoney(totals.total)}</Text>
                </View>
                <View style={styles.saldoCol}>
                  <Text style={styles.colLabel}>Quota {cfg.parent1_name?.split(" ")[0]}</Text>
                  <Text style={styles.colValue}>{formatMoney(totals.quota_parent1)}</Text>
                </View>
                <View style={styles.saldoCol}>
                  <Text style={styles.colLabel}>Quota {cfg.parent2_name?.split(" ")[0]}</Text>
                  <Text style={styles.colValue}>{formatMoney(totals.quota_parent2)}</Text>
                </View>
              </View>
            </View>
            {closed && b.bonifico && (
              <View style={styles.bonifico}>
                <Text style={styles.bonLabel}>Bonifico registrato</Text>
                <Text style={styles.bonValue}>
                  {formatDateIt(b.bonifico.bonifico_date)} · {formatMoney(b.bonifico.bonifico_amount)}
                </Text>
                {b.bonifico.bonifico_note ? (
                  <Text style={styles.bonNote}>{b.bonifico.bonifico_note}</Text>
                ) : null}
              </View>
            )}
            <Text style={styles.sectionTitle}>Spese ({b.expenses.length})</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nessuna spesa</Text>
            <Text style={styles.emptyText}>
              {closed ? "Nessuna spesa registrata." : "Tocca + per aggiungerne una."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.expCard}>
            <View style={{ flex: 1 }}>
              <View style={styles.expTopRow}>
                <Text style={styles.expDesc} numberOfLines={1}>
                  {item.description}
                </Text>
                {item.has_attachment && <Paperclip color={colors.muted} size={14} />}
              </View>
              <Text style={styles.expMeta}>
                {formatDateIt(item.date)} · {item.paid_by === "parent1" ? cfg.parent1_name : cfg.parent2_name}{" "}
                · {item.pct_parent1}% / {item.pct_parent2}%
              </Text>
            </View>
            <Text style={styles.expAmount}>{formatMoney(item.amount)}</Text>
            {!closed && (
              <View style={styles.expActions}>
                <Pressable
                  testID={`edit-${item.expense_id}`}
                  onPress={() => router.push(`/block/${id}/expense?eid=${item.expense_id}`)}
                  hitSlop={6}
                >
                  <Pencil color={colors.brandPrimary} size={18} />
                </Pressable>
                <Pressable
                  testID={`delete-${item.expense_id}`}
                  onPress={() => deleteExpense(item.expense_id)}
                  hitSlop={6}
                >
                  <Trash2 color={colors.error} size={18} />
                </Pressable>
              </View>
            )}
          </View>
        )}
      />

      {!closed && (
        <View style={[styles.footerBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            testID="close-block-btn"
            onPress={() => router.push(`/block/${id}/close`)}
            style={styles.closeBtn}
          >
            <Lock color={colors.onBrandPrimary} size={18} />
            <Text style={styles.closeBtnText}>Chiudi blocco e invia email</Text>
          </Pressable>
        </View>
      )}

      {!closed && (
        <Pressable
          testID="fab-add-expense"
          onPress={() => router.push(`/block/${id}/expense`)}
          style={[styles.fab, { bottom: insets.bottom + 80 }]}
        >
          <Plus color={colors.onBrandPrimary} size={28} />
        </Pressable>
      )}

      {closed && (
        <View style={[styles.footerBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable testID="resend-email" onPress={resend} disabled={busy} style={styles.closeBtn}>
            {busy ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Send color={colors.onBrandPrimary} size={18} />
                <Text style={styles.closeBtnText}>Reinvia email a te</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
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
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface, flex: 1, textAlign: "center" },
  saldoCard: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  saldoCardLabel: { color: colors.brandPrimary, fontSize: 13, fontWeight: "600" },
  saldoCardValue: {
    color: colors.onSurface,
    fontSize: 36,
    fontWeight: "800",
    marginTop: 4,
  },
  saldoRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 8,
  },
  saldoCol: { flex: 1 },
  colLabel: { color: colors.muted, fontSize: 11 },
  colValue: { color: colors.onSurface, fontSize: 14, fontWeight: "600", marginTop: 2 },
  bonifico: {
    backgroundColor: colors.success,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  bonLabel: { color: colors.onSuccess, fontSize: 12, fontWeight: "600", opacity: 0.9 },
  bonValue: { color: colors.onSuccess, fontSize: 16, fontWeight: "700", marginTop: 2 },
  bonNote: { color: colors.onSuccess, fontSize: 12, marginTop: 4, opacity: 0.9 },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  expCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  expTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  expDesc: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  expMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  expAmount: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  expActions: { flexDirection: "row", gap: 12, marginLeft: 8 },
  empty: { alignItems: "center", marginTop: 40 },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  emptyText: { color: colors.muted, marginTop: 4 },
  footerBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  closeBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  closeBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "600" },
  fab: {
    position: "absolute",
    alignSelf: "center",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
