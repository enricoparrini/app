import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Send } from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { formatMoney, todayIso } from "@/src/utils/format";

export default function CloseBlock() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [block, setBlock] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"parent1_to_parent2" | "parent2_to_parent1" | "none">(
    "none"
  );
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      const [{ block: b }, { config: c }] = await Promise.all([
        api.getBlock(id!),
        api.getConfig(),
      ]);
      setBlock(b);
      setCfg(c);
      const saldo = b?.totals?.saldo || 0;
      if (saldo > 0.01) {
        setDirection("parent2_to_parent1");
        setAmount(saldo.toFixed(2));
      } else if (saldo < -0.01) {
        setDirection("parent1_to_parent2");
        setAmount(Math.abs(saldo).toFixed(2));
      }
      setLoading(false);
    })();
  }, [id]);

  const confirmAndSend = async () => {
    setErr(null);
    const amtN = parseFloat((amount || "0").replace(",", "."));
    if (isNaN(amtN) || amtN < 0) return setErr("Importo bonifico non valido");
    setSaving(true);
    try {
      await api.closeBlock(id!, {
        bonifico_date: date,
        bonifico_amount: amtN,
        bonifico_direction: direction,
        bonifico_note: note.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ["blocks"] });
      qc.invalidateQueries({ queryKey: ["block", id] });
      Alert.alert("Blocco chiuso", "Email inviata a entrambi i genitori.");
      router.replace(`/block/${id}`);
    } catch (e: any) {
      setErr(e.message || "Errore invio email");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !block || !cfg) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const saldo = block.totals.saldo;
  const saldoText =
    Math.abs(saldo) < 0.01
      ? "Nessun saldo dovuto"
      : saldo > 0
      ? `${cfg.parent2_name} deve a te ${formatMoney(saldo)}`
      : `Tu devi a ${cfg.parent2_name} ${formatMoney(Math.abs(saldo))}`;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="back-close" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title}>Chiudi blocco</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 120, gap: 12 }}
      >
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>{block.label}</Text>
          <Text style={styles.summaryValue}>{formatMoney(block.totals.total)}</Text>
          <Text style={styles.summarySaldo}>{saldoText}</Text>
        </View>

        <Text style={styles.label}>Direzione bonifico</Text>
        <View style={styles.segmented}>
          <SegBtn
            label={`${cfg.parent2_name.split(" ")[0]} → ${cfg.parent1_name.split(" ")[0]}`}
            selected={direction === "parent2_to_parent1"}
            onPress={() => setDirection("parent2_to_parent1")}
            testID="dir-p2-p1"
          />
          <SegBtn
            label={`${cfg.parent1_name.split(" ")[0]} → ${cfg.parent2_name.split(" ")[0]}`}
            selected={direction === "parent1_to_parent2"}
            onPress={() => setDirection("parent1_to_parent2")}
            testID="dir-p1-p2"
          />
          <SegBtn
            label="Nessuno"
            selected={direction === "none"}
            onPress={() => setDirection("none")}
            testID="dir-none"
          />
        </View>

        <Field
          label="Data bonifico (AAAA-MM-GG)"
          value={date}
          onChangeText={setDate}
          testID="bon-date"
        />
        <Field
          label="Importo bonifico (€)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          testID="bon-amount"
        />
        <Field
          label="Note (opzionale)"
          value={note}
          onChangeText={setNote}
          testID="bon-note"
          multiline
        />

        {err && <Text style={styles.err}>{err}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          testID="confirm-close"
          onPress={confirmAndSend}
          disabled={saving}
          style={styles.btn}
        >
          {saving ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <Send color={colors.onBrandPrimary} size={18} />
              <Text style={styles.btnText}>Conferma e invia email</Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  testID,
  ...rest
}: React.ComponentProps<typeof TextInput> & { label: string; testID?: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...rest}
      />
    </View>
  );
}

function SegBtn({ selected, onPress, label, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.segBtn, selected && styles.segBtnActive]}
    >
      <Text style={[styles.segBtnText, selected && styles.segBtnTextActive]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  summary: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 16,
    padding: 16,
  },
  summaryLabel: { color: colors.brandPrimary, fontSize: 13, fontWeight: "600" },
  summaryValue: {
    color: colors.onSurface,
    fontSize: 28,
    fontWeight: "800",
    marginTop: 4,
  },
  summarySaldo: { color: colors.onSurface, marginTop: 8 },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "500" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.onSurface,
    fontSize: 16,
    marginTop: 6,
  },
  segmented: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  segBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  segBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 12, textAlign: "center" },
  segBtnTextActive: { color: colors.onBrandPrimary },
  footer: {
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
  btn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  btnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "600" },
  err: { color: colors.error, marginTop: 8 },
});
