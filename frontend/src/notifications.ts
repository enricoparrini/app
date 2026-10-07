import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === "granted";
}

/**
 * Schedule reminder notifications:
 * - Each of the 5 days before settlementDay: "Non hai registrato spese questo mese"
 * - On settlementDay: "Promemoria saldo"
 * These are schedule-only; the user should cancel/reschedule when a block is closed
 * or expenses are added. We re-schedule on app launch.
 */
export async function scheduleReminders(settlementDay: number) {
  if (Platform.OS === "web") return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed current

  for (let i = 0; i < 3; i++) {
    const m = (month + i) % 12;
    const y = year + Math.floor((month + i) / 12);
    const settle = new Date(y, m, settlementDay, 10, 0, 0);
    for (let d = 5; d >= 1; d--) {
      const trigger = new Date(settle);
      trigger.setDate(trigger.getDate() - d);
      if (trigger > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Spese extra",
            body: "Non hai ancora registrato spese questo mese. Vuoi aggiungerle ora?",
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger } as any,
        });
      }
    }
    if (settle > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Promemoria saldo",
          body: "Oggi è il giorno del saldo. Verifica le spese del mese e chiudi il blocco.",
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: settle } as any,
      });
    }
  }
}
