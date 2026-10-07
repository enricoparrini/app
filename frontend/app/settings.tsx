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
import { ChevronLeft, LogOut, Archive } from "lucide-react-native";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/contexts/AuthContext";
import { colors } from "@/src/theme";
import { scheduleReminders } from "@/src/notifications";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parent1, setParent1] = useState("");
  const [parent2, setParent2] = useState("");
  const [parent2Email, setParent2Email] = useState("");
  const [pct, setPct] = useState("50");
  const [day, setDay] = useState("20");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { config } = await api.getConfig();
      if (config) {
        setParent1(config.parent1_name || "");
        setParent2(config.parent2_name || "");
        setParent2Email(config.parent2_email || "");
        setPct(String(config.default_pct_parent1 ?? 50));
        setDay(String(config.settlement_day ?? 20));
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const pctN = parseFloat(pct);
      const dayN = parseInt(day, 10);
      await api.putConfig({
        parent1_name: parent1.trim(),
        parent2_name: parent2.trim(),
        parent2_email: parent2Email.trim(),
        default_pct_parent1: pctN,
        settlement_day: dayN,
      });
      await scheduleReminders(dayN);
      setMsg("Impostazioni salvate");
    } catch (e: any) {
      setMsg(e.message || "Errore");
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
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="back-settings" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title}>Impostazioni</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 12 }}
      >
        <Text style={styles.email}>Account: {user?.email}</Text>

        <Field label="Nome genitore 1" value={parent1} onChangeText={setParent1} testID="set-p1" />
        <Field label="Nome genitore 2" value={parent2} onChangeText={setParent2} testID="set-p2" />
        <Field
          label="Email genitore 2"
          value={parent2Email}
          onChangeText={setParent2Email}
          keyboardType="email-address"
          autoCapitalize="none"
          testID="set-p2-email"
        />
        <Field
          label="% genitore 1 (default)"
          value={pct}
          onChangeText={setPct}
          keyboardType="numeric"
          testID="set-pct"
        />
        <Field
          label="Giorno saldo (1-28)"
          value={day}
          onChangeText={setDay}
          keyboardType="numeric"
          testID="set-day"
        />

        {msg && <Text style={styles.msg}>{msg}</Text>}

        <Pressable testID="save-settings" onPress={save} disabled={saving} style={styles.btn}>
          {saving ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.btnText}>Salva</Text>
          )}
        </Pressable>

        <Pressable
          testID="open-archive"
          onPress={() => router.push("/archive")}
          style={styles.secondaryBtn}
        >
          <Archive color={colors.onSurface} size={18} />
          <Text style={styles.secondaryBtnText}>Vai all&apos;archivio</Text>
        </Pressable>

        <Pressable testID="logout" onPress={signOut} style={styles.dangerBtn}>
          <LogOut color={colors.error} size={18} />
          <Text style={styles.dangerText}>Esci</Text>
        </Pressable>
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  email: { color: colors.muted, marginBottom: 8 },
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
  btn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  secondaryBtnText: { color: colors.onSurface, fontWeight: "600" },
  dangerBtn: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  dangerText: { color: colors.error, fontWeight: "600" },
  msg: { color: colors.success, textAlign: "center" },
});
