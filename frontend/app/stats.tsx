import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Download, Mail } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { formatMoney, MONTHS_IT } from "@/src/utils/format";

type Row = {
  key: string;
  month: number;
  year: number;
  total: number;
  paid_p1: number;
  pct: number;
};

export default function Stats() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<any>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    api.getConfig().then((r) => setCfg(r.config));
  }, []);

  const q = useQuery({
    queryKey: ["blocks"],
    queryFn: () => api.listBlocks(),
  });

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2];
  }, []);

  if (q.isLoading || !cfg) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const blocks = q.data?.blocks || [];

  // Build 12 months of selected year (Jan..Dec)
  const rows: Row[] = [];
  for (let m = 1; m <= 12; m++) {
    const b = blocks.find((x: any) => x.month === m && x.year === year);
    const total = b?.totals?.total ?? 0;
    const paid_p1 = b?.totals?.paid_parent1 ?? 0;
    const pct = total > 0 ? (paid_p1 / total) * 100 : 0;
    rows.push({ key: `${year}-${m}`, month: m, year, total, paid_p1, pct });
  }

  const yearTotal = rows.reduce((s, r) => s + r.total, 0);
  const yearPaidP1 = rows.reduce((s, r) => s + r.paid_p1, 0);
  const yearPct = yearTotal > 0 ? (yearPaidP1 / yearTotal) * 100 : 0;
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await api.exportYear(year);
      if (Platform.OS === "web") {
        // Trigger browser download
        const link = document.createElement("a");
        link.href = `data:${res.mime};base64,${res.data}`;
        link.download = res.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
        const path = `${dir}${res.filename}`;
        await FileSystem.writeAsStringAsync(path, res.data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(path, {
            mimeType: res.mime,
            dialogTitle: res.filename,
            UTI: "com.adobe.pdf",
          });
        } else {
          Alert.alert("PDF salvato", `Il file è stato salvato in: ${path}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile scaricare il PDF");
    } finally {
      setDownloading(false);
    }
  };

  const emailPdf = async () => {
    setEmailing(true);
    try {
      await api.emailYear(year);
      Alert.alert("Email inviata", `Il PDF ${year} è stato inviato alla tua email.`);
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Invio email fallito");
    } finally {
      setEmailing(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back-stats" onPress={() => router.back()} hitSlop={10}>
          <ChevronLeft color={colors.onSurface} size={26} />
        </Pressable>
        <Text style={styles.title}>Grafico annuale</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 24,
          gap: 12,
        }}
      >
        <View style={styles.yearChips}>
          {years.map((y) => (
            <Pressable
              key={y}
              testID={`year-${y}`}
              onPress={() => setYear(y)}
              style={[styles.yearChip, year === y && styles.yearChipActive]}
            >
              <Text style={[styles.yearChipText, year === y && styles.yearChipTextActive]}>
                {y}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.summary} testID="stats-year-summary">
          <Text style={styles.summaryLabel}>
            {cfg.parent1_name} · anno {year}
          </Text>
          <Text style={styles.summaryValue}>
            {formatMoney(yearPaidP1)} / {formatMoney(yearTotal)}
          </Text>
          <Text style={styles.summaryPct} testID="stats-year-pct">
            {yearPct.toFixed(1)}% del totale
          </Text>
          <View style={styles.yearBarBg}>
            <View
              style={[styles.yearBarFill, { width: `${Math.min(100, yearPct)}%` }]}
            />
          </View>
        </View>

        <View style={styles.exportRow}>
          <Pressable
            testID="download-year-pdf"
            onPress={downloadPdf}
            disabled={downloading}
            style={styles.exportBtn}
          >
            {downloading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Download color={colors.onBrandPrimary} size={16} />
                <Text style={styles.exportBtnText}>Scarica PDF 730</Text>
              </>
            )}
          </Pressable>
          <Pressable
            testID="email-year-pdf"
            onPress={emailPdf}
            disabled={emailing}
            style={styles.exportBtnOutline}
          >
            {emailing ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (
              <>
                <Mail color={colors.brandPrimary} size={16} />
                <Text style={styles.exportBtnOutlineText}>Invia via email</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.brandPrimary }]} />
            <Text style={styles.legendText}>Pagato da {cfg.parent1_name}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.brandSecondary }]} />
            <Text style={styles.legendText}>Resto del totale</Text>
          </View>
        </View>

        {rows.map((r) => (
          <MonthBar key={r.key} row={r} maxTotal={maxTotal} />
        ))}
      </ScrollView>
    </View>
  );
}

function MonthBar({ row, maxTotal }: { row: Row; maxTotal: number }) {
  const widthPct = (row.total / maxTotal) * 100;
  const paidPct = row.total > 0 ? (row.paid_p1 / row.total) * 100 : 0;
  const label = `${MONTHS_IT[row.month - 1].slice(0, 3)} '${String(row.year).slice(-2)}`;
  const empty = row.total === 0;
  return (
    <View style={styles.row} testID={`stats-row-${row.year}-${row.month}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <View style={styles.barBg}>
          <View style={[styles.barTotal, { width: `${widthPct}%` }]}>
            <View style={[styles.barPaid, { width: `${paidPct}%` }]} />
          </View>
        </View>
        <View style={styles.rowValues}>
          <Text style={[styles.rowValuePaid, empty && { color: colors.muted }]}>
            {empty ? "—" : formatMoney(row.paid_p1)}
          </Text>
          <Text style={styles.rowValueTotal}>
            {empty ? "" : `/ ${formatMoney(row.total)}  ·  ${paidPct.toFixed(0)}%`}
          </Text>
        </View>
      </View>
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
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface },

  yearChips: { flexDirection: "row", gap: 8 },
  yearChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  yearChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  yearChipText: { color: colors.onSurface, fontWeight: "600" },
  yearChipTextActive: { color: colors.onBrandPrimary },

  summary: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 20,
    padding: 20,
  },
  summaryLabel: { color: colors.brandPrimary, fontSize: 13, fontWeight: "600" },
  summaryValue: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 4 },
  summaryPct: { color: colors.onSurface, marginTop: 2, fontSize: 14 },
  yearBarBg: {
    marginTop: 12,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.brandSecondary,
    overflow: "hidden",
  },
  yearBarFill: { height: "100%", backgroundColor: colors.brandPrimary },

  exportRow: { flexDirection: "row", gap: 10 },
  exportBtn: {
    flex: 1,
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  exportBtnText: { color: colors.onBrandPrimary, fontWeight: "600", fontSize: 14 },
  exportBtnOutline: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  exportBtnOutlineText: { color: colors.brandPrimary, fontWeight: "600", fontSize: 14 },

  legend: { flexDirection: "row", gap: 16, marginTop: 4, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.muted, fontSize: 12 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  rowLabel: {
    width: 54,
    color: colors.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  rowRight: { flex: 1 },
  barBg: {
    height: 14,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  barTotal: {
    height: "100%",
    backgroundColor: colors.brandSecondary,
    borderRadius: 999,
    overflow: "hidden",
  },
  barPaid: { height: "100%", backgroundColor: colors.brandPrimary },
  rowValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: 4,
  },
  rowValuePaid: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  rowValueTotal: { color: colors.muted, fontSize: 12 },
});
