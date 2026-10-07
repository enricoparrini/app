import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { ChevronLeft, Paperclip, X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { todayIso } from "@/src/utils/format";

export default function ExpenseForm() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<any>(null);

  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<"parent1" | "parent2">("parent1");
  const [pct1, setPct1] = useState<number>(50);

  const [attData, setAttData] = useState<string | null>(null);
  const [attMime, setAttMime] = useState<string | null>(null);
  const [attName, setAttName] = useState<string | null>(null);
  const [attPreview, setAttPreview] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { config } = await api.getConfig();
      setCfg(config);
      if (!eid) setPct1(config?.default_pct_parent1 ?? 50);
      if (eid) {
        const { block } = await api.getBlock(id!);
        const found = (block.expenses || []).find((e: any) => e.expense_id === eid);
        if (found) {
          setDate(found.date);
          setDesc(found.description);
          setAmount(String(found.amount));
          setPaidBy(found.paid_by);
          setPct1(found.pct_parent1);
          if (found.has_attachment) {
            const att = await api.getAttachment(id!, eid).catch(() => null);
            if (att) {
              setAttData(att.data);
              setAttMime(att.mime);
              setAttName(att.name);
              if (att.mime?.startsWith("image/"))
                setAttPreview(`data:${att.mime};base64,${att.data}`);
            }
          }
        }
      }
      setLoading(false);
    })();
  }, [id, eid]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    const manipulated = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    setAttData(manipulated.base64 || null);
    setAttMime("image/jpeg");
    setAttName(`scontrino_${Date.now()}.jpg`);
    setAttPreview(`data:image/jpeg;base64,${manipulated.base64}`);
  };

  const pickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled) return;
    const file = res.assets[0];
    const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    setAttData(b64);
    setAttMime("application/pdf");
    setAttName(file.name || "allegato.pdf");
    setAttPreview(null);
  };

  const removeAttachment = () => {
    setAttData(null);
    setAttMime(null);
    setAttName(null);
    setAttPreview(null);
  };

  const save = async () => {
    setErr(null);
    const amtN = parseFloat(amount.replace(",", "."));
    if (!desc.trim()) return setErr("Inserisci una descrizione");
    if (isNaN(amtN) || amtN <= 0) return setErr("Importo non valido");
    if (pct1 < 0 || pct1 > 100) return setErr("Percentuale non valida");

    setSaving(true);
    try {
      const payload: any = {
        date,
        description: desc.trim(),
        amount: amtN,
        paid_by: paidBy,
        pct_parent1: pct1,
        pct_parent2: 100 - pct1,
        attachment_data: attData,
        attachment_mime: attMime,
        attachment_name: attName,
      };
      if (eid) await api.updateExpense(id!, eid, payload);
      else await api.addExpense(id!, payload);
      qc.invalidateQueries({ queryKey: ["block", id] });
      qc.invalidateQueries({ queryKey: ["blocks"] });
      router.back();
    } catch (e: any) {
      setErr(e.message || "Errore");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !cfg) {
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
        <Pressable testID="back-expense" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title}>{eid ? "Modifica spesa" : "Nuova spesa"}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 120, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Data (AAAA-MM-GG)" value={date} onChangeText={setDate} testID="exp-date" />
        <Field label="Descrizione" value={desc} onChangeText={setDesc} testID="exp-desc" />
        <Field
          label="Importo (€)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          testID="exp-amount"
        />

        <Text style={styles.label}>Pagato da</Text>
        <View style={styles.segmented}>
          <SegBtn
            selected={paidBy === "parent1"}
            onPress={() => setPaidBy("parent1")}
            label={cfg.parent1_name}
            testID="seg-p1"
          />
          <SegBtn
            selected={paidBy === "parent2"}
            onPress={() => setPaidBy("parent2")}
            label={cfg.parent2_name}
            testID="seg-p2"
          />
        </View>

        <Text style={styles.label}>Divisione: {cfg.parent1_name} {pct1.toFixed(0)}% · {cfg.parent2_name} {(100 - pct1).toFixed(0)}%</Text>
        <View style={styles.pctRow}>
          {[0, 25, 50, 75, 100].map((v) => (
            <Pressable
              key={v}
              testID={`pct-${v}`}
              onPress={() => setPct1(v)}
              style={[styles.pctChip, pct1 === v && styles.pctChipActive]}
            >
              <Text style={[styles.pctChipText, pct1 === v && styles.pctChipTextActive]}>
                {v}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          testID="pct-input"
          value={String(pct1)}
          onChangeText={(t) => {
            const n = parseInt(t.replace(/\D/g, "") || "0", 10);
            if (!isNaN(n) && n <= 100) setPct1(n);
          }}
          keyboardType="numeric"
          style={[styles.input, { textAlign: "center" }]}
        />

        <Text style={styles.label}>Allegato (opzionale)</Text>
        {attData ? (
          <View style={styles.attachmentBox}>
            {attPreview ? (
              <Image source={{ uri: attPreview }} style={styles.thumb} />
            ) : (
              <View style={styles.thumbPdf}>
                <Paperclip color={colors.onSurface} size={24} />
                <Text style={{ marginTop: 4, color: colors.muted, fontSize: 11 }}>PDF</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.attName} numberOfLines={1}>{attName}</Text>
              <Pressable testID="remove-attachment" onPress={removeAttachment}>
                <Text style={{ color: colors.error, marginTop: 6 }}>Rimuovi</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.attachRow}>
            <Pressable testID="attach-image" onPress={pickImage} style={styles.attachBtn}>
              <Paperclip color={colors.brandPrimary} size={16} />
              <Text style={styles.attachBtnText}>Immagine</Text>
            </Pressable>
            <Pressable testID="attach-pdf" onPress={pickDocument} style={styles.attachBtn}>
              <Paperclip color={colors.brandPrimary} size={16} />
              <Text style={styles.attachBtnText}>PDF</Text>
            </Pressable>
          </View>
        )}

        {err && <Text style={styles.err}>{err}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable testID="save-expense" onPress={save} disabled={saving} style={styles.btn}>
          {saving ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.btnText}>Salva spesa</Text>
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
      <Text style={[styles.segBtnText, selected && styles.segBtnTextActive]} numberOfLines={1}>
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
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "500", marginTop: 4 },
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
    gap: 8,
    marginTop: 6,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
  },
  segBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  segBtnText: { color: colors.onSurface, fontWeight: "600" },
  segBtnTextActive: { color: colors.onBrandPrimary },
  pctRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  pctChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  pctChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  pctChipText: { color: colors.onSurface, fontWeight: "600" },
  pctChipTextActive: { color: colors.brandPrimary },
  attachmentBox: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  thumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
  thumbPdf: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  attName: { color: colors.onSurface, fontWeight: "600" },
  attachRow: { flexDirection: "row", gap: 10 },
  attachBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
    borderStyle: "dashed",
  },
  attachBtnText: { color: colors.brandPrimary, fontWeight: "600" },
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
  },
  btnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "600" },
  err: { color: colors.error, marginTop: 8 },
});
