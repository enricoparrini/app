import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { formatMoney, MONTHS_IT } from "@/src/utils/format";

type Row = {
  key: string;
  month: number;
  year: number;
  total: number;
  paid_p1: number;
  pct: number; // paid_p1 / total * 100
};

export default function Stats() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<any>(null);

  useEffect(() => {
    api.getConfig().then((r) => setCfg(r.config));
  }, []);

  const q = useQuery({
    queryKey: ["blocks"],
    queryFn: () => api.listBlocks(),
  });

  if (q.isLoading || !cfg) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const blocks = q.data?.blocks || [];
  // Build last 12 months rows (newest first)
  const now = new Date();
  const rows: Row[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const b = blocks.find((x: any) => x.month === m && x.year === y);
    const total = b?.totals?.total ?? 0;
    const paid_p1 = b?.totals?.paid_parent1 ?? 0;
    const pct = total > 0 ? (paid_p1 / total) * 100 : 0;
    rows.push({ key: `${y}-${m}`, month: m, year: y, total, paid_p1, pct });
  }

  const yearTotal = rows.reduce((s, r) => s + r.total, 0);
  const yearPaidP1 = rows.reduce((s, r) => s + r.paid_p1, 0);
  const yearPct = yearTotal > 0 ? (yearPaidP1 / yearTotal) * 100 : 0;

  // Max for scale (so bars are comparable)
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

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
        <View style={styles.summary} testID="stats-year-summary">
          <Text style={styles.summaryLabel}>
            {cfg.parent1_name} negli ultimi 12 mesi
          </Text>
          <Text style={styles.summaryValue}>
            {formatMoney(yearPaidP1)} / {formatMoney(yearTotal)}
          </Text>
          <Text style={styles.summaryPct} testID="stats-year-pct">
            {yearPct.toFixed(1)}% del totale
          </Text>
          <View style={styles.yearBarBg}>
            <View
              style={[
                styles.yearBarFill,
                { width: `${Math.min(100, yearPct)}%` },
              ]}
            />
          </View>
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
          <MonthBar
            key={r.key}
            row={r}
            maxTotal={maxTotal}
          />
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
          <View
            style={[
              styles.barTotal,
              { width: `${widthPct}%` },
            ]}
          >
            <View
              style={[
                styles.barPaid,
                { width: `${paidPct}%` },
              ]}
            />
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

  summary: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 20,
    padding: 20,
  },
  summaryLabel: { color: colors.brandPrimary, fontSize: 13, fontWeight: "600" },
  summaryValue: {
    color: colors.onSurface,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 4,
  },
  summaryPct: { color: colors.onSurface, marginTop: 2, fontSize: 14 },
  yearBarBg: {
    marginTop: 12,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.brandSecondary,
    overflow: "hidden",
  },
  yearBarFill: {
    height: "100%",
    backgroundColor: colors.brandPrimary,
  },

  legend: {
    flexDirection: "row",
    gap: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.muted, fontSize: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
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
  barPaid: {
    height: "100%",
    backgroundColor: colors.brandPrimary,
  },
  rowValues: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: 4,
  },
  rowValuePaid: {
    color: colors.onSurface,
    fontSize: 13,
    fontWeight: "700",
  },
  rowValueTotal: {
    color: colors.muted,
    fontSize: 12,
  },
});
