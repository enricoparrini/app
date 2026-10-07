import * as Notifications from "expo-notifications";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

/**
 * Expo Go rimuove le API di notifiche push remote da SDK 53+ e inoltre lo
 * scheduling delle notifiche locali può crashare o essere ignorato.
 * Rileviamo l'ambiente e disabilitiamo tutta l'inizializzazione nelle preview.
 */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Il handler lavora bene sia in Expo Go sia in native builds, ma lo
// registriamo solo quando NON siamo in Expo Go per evitare qualunque
// side-effect in preview.
if (!isExpoGo && Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function requestPermission(): Promise<boolean> {
  if (isExpoGo || Platform.OS === "web") return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === "granted";
  } catch {
    return false;
  }
}

/**
 * Schedule reminder notifications:
 * - Each of the 5 days before settlementDay: "Non hai registrato spese questo mese"
 * - On settlementDay: "Promemoria saldo"
 * In Expo Go o sul web non facciamo nulla: le notifiche si attivano solo nel
 * development build o nel build di produzione.
 */
export async function scheduleReminders(settlementDay: number) {
  if (isExpoGo || Platform.OS === "web") return;
  try {
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
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: trigger,
            } as any,
          });
        }
      }
      if (settle > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Promemoria saldo",
            body: "Oggi è il giorno del saldo. Verifica le spese del mese e chiudi il blocco.",
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: settle,
          } as any,
        });
      }
    }
  } catch (e) {
    // In caso di errore (ad esempio ambiente inatteso) non vogliamo
    // interrompere il flusso dell'app.
    console.log("scheduleReminders skipped:", e);
  }
}
