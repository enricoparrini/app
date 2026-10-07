import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LogIn, Wallet } from "lucide-react-native";
import { useAuth } from "@/src/contexts/AuthContext";
import { colors } from "@/src/theme";
import { api } from "@/src/api/client";

export default function Login() {
  const { signIn, user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      if (user) {
        const { config } = await api.getConfig().catch(() => ({ config: null }));
        router.replace(config ? "/" : "/setup");
      }
    })();
  }, [user, router]);

  const onPress = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Wallet color={colors.onBrandPrimary} size={36} />
        </View>
        <Text testID="login-title" style={styles.title}>Quota</Text>
        <Text style={styles.subtitle}>
          Gestisci con chiarezza le spese extra di mantenimento, mese dopo mese.
        </Text>
      </View>

      <View style={styles.footer}>
        <Pressable
          testID="google-signin-button"
          onPress={onPress}
          disabled={busy || loading}
          style={({ pressed }) => [styles.btn, { opacity: pressed || busy ? 0.8 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <LogIn color={colors.onBrandPrimary} size={20} />
              <Text style={styles.btnText}>Accedi con Google</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>
          L&apos;accesso serve solo per identificare il genitore 1 e inviare automaticamente il riepilogo via email.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 24 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: { fontSize: 36, fontWeight: "700", color: colors.onSurface, marginBottom: 8 },
  subtitle: {
    fontSize: 16,
    color: colors.muted,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 22,
  },
  footer: { paddingBottom: 24, gap: 12 },
  btn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  btnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "600" },
  hint: { textAlign: "center", color: colors.muted, fontSize: 12, paddingHorizontal: 12 },
});
