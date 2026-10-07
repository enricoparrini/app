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
      // Precompila importo bonifico solo se genitore 1 deve a genitore 2
      if (saldo < -0.01) setAmount(Math.abs(saldo).toFixed(2));
      setLoading(false);
    })();
  }, [id]);

  const saldo = block?.totals?.saldo ?? 0;
  // Genitore 1 deve pagare solo se saldo < 0 (ha pagato meno della sua quota)
  const parent1Owes = saldo < -0.01;

  const confirmAndSend = async () => {
    setErr(null);
    let direction: "parent1_to_parent2" | "parent2_to_parent1" | "none" = "none";
    if (saldo > 0.01) direction = "parent2_to_parent1";
    else if (saldo < -0.01) direction = "parent1_to_parent2";

    let bonAmount = 0;
    let bonDate = date;
    if (parent1Owes) {
      const amtN = parseFloat((amount || "0").replace(",", "."));
      if (isNaN(amtN) || amtN <= 0)
        return setErr("Inserisci l'importo del bonifico");
      bonAmount = amtN;
    } else {
      // Nessun bonifico richiesto: data=oggi, importo=0, direction derivata
      bonDate = todayIso();
    }

    setSaving(true);
    try {
      const res: any = await api.closeBlock(id!, {
        bonifico_date: bonDate,
        bonifico_amount: bonAmount,
        bonifico_direction: direction,
        bonifico_note: note.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ["blocks"] });
      qc.invalidateQueries({ queryKey: ["block", id] });
      if (res?.email_sent === false) {
        Alert.alert(
          "Blocco chiuso, email non inviata",
          `Il blocco è stato chiuso ma l'invio dell'email è fallito: ${res.email_error || "errore sconosciuto"}.\n\nVerifica l'indirizzo del Genitore 2 nelle impostazioni e usa "Reinvia email" dalla pagina del blocco.`
        );
      } else {
        Alert.alert("Blocco chiuso", "Email inviata a entrambi i genitori.");
      }
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

        {parent1Owes ? (
          <>
            <Text style={styles.sectionTitle}>Dati del bonifico</Text>
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
          </>
        ) : (
          <View style={styles.noBonifico} testID="no-bonifico-info">
            <Text style={styles.noBonTitle}>Nessun bonifico necessario</Text>
            <Text style={styles.noBonText}>
              {Math.abs(saldo) < 0.01
                ? "Il blocco verrà chiuso in pareggio."
                : `Nell'email verrà indicato che ${cfg.parent2_name} deve ${formatMoney(saldo)} a ${cfg.parent1_name}.`}
            </Text>
          </View>
        )}

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
              <Text style={styles.btnText}>
                {parent1Owes ? "Conferma e invia email" : "Chiudi e invia email"}
              </Text>
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
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  noBonifico: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noBonTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  noBonText: { color: colors.muted, marginTop: 4, lineHeight: 18 },
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
