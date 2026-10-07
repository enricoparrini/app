import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { api } from "@/src/api/client";
import { useAuth } from "@/src/contexts/AuthContext";
import { colors } from "@/src/theme";
import { scheduleReminders, requestPermission } from "@/src/notifications";

export default function Setup() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parent1, setParent1] = useState("");
  const [parent2, setParent2] = useState("");
  const [parent2Email, setParent2Email] = useState("");
  const [pct, setPct] = useState("50");
  const [day, setDay] = useState("20");

  useEffect(() => {
    (async () => {
      try {
        const { config } = await api.getConfig();
        if (config) {
          setParent1(config.parent1_name || "");
          setParent2(config.parent2_name || "");
          setParent2Email(config.parent2_email || "");
          setPct(String(config.default_pct_parent1 ?? 50));
          setDay(String(config.settlement_day ?? 20));
        } else if (user?.name) {
          setParent1(user.name);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const save = async () => {
    setErr(null);
    const pctN = parseFloat(pct);
    const dayN = parseInt(day, 10);
    if (!parent1.trim() || !parent2.trim() || !parent2Email.trim()) {
      setErr("Compila tutti i campi obbligatori");
      return;
    }
    if (isNaN(pctN) || pctN < 0 || pctN > 100) {
      setErr("Percentuale non valida");
      return;
    }
    if (isNaN(dayN) || dayN < 1 || dayN > 28) {
      setErr("Giorno saldo deve essere 1-28");
      return;
    }
    setSaving(true);
    try {
      await api.putConfig({
        parent1_name: parent1.trim(),
        parent2_name: parent2.trim(),
        parent2_email: parent2Email.trim(),
        default_pct_parent1: pctN,
        settlement_day: dayN,
      });
      await requestPermission();
      await scheduleReminders(dayN);
      router.replace("/");
    } catch (e: any) {
      setErr(e.message || "Errore");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Configurazione</Text>
        <Text style={styles.subtitle}>Imposta i nomi, l&apos;email del genitore 2 e la divisione predefinita.</Text>

        <Field label="Nome genitore 1 (tu)" value={parent1} onChangeText={setParent1} testID="setup-parent1" />
        <Field label="Nome genitore 2" value={parent2} onChangeText={setParent2} testID="setup-parent2" />
        <Field
          label="Email genitore 2"
          value={parent2Email}
          onChangeText={setParent2Email}
          keyboardType="email-address"
          autoCapitalize="none"
          testID="setup-parent2-email"
        />
        <Field
          label="% a carico genitore 1 (default)"
          value={pct}
          onChangeText={setPct}
          keyboardType="numeric"
          testID="setup-pct"
        />
        <Field
          label="Giorno del mese del saldo (1-28)"
          value={day}
          onChangeText={setDay}
          keyboardType="numeric"
          testID="setup-day"
        />

        {err && <Text style={styles.err}>{err}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          testID="setup-save"
          onPress={save}
          disabled={saving}
          style={({ pressed }) => [styles.btn, { opacity: pressed || saving ? 0.8 : 1 }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.btnText}>Salva e continua</Text>
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
    <View style={styles.field}>
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
  content: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 4 },
  subtitle: { color: colors.muted, marginBottom: 16 },
  field: { marginBottom: 4 },
  label: { color: colors.onSurfaceSecondary, marginBottom: 6, fontSize: 13, fontWeight: "500" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.onSurface,
    fontSize: 16,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  btn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "600" },
  err: { color: colors.error, marginTop: 8 },
});
