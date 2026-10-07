# Quota — Spese extra di mantenimento

## Panoramica
App mobile Android in italiano per gestire le spese extra di mantenimento tra due genitori.
Sostituisce il tradizionale file Excel con blocchi mensili ("Spese extra Ottobre '26"), calcolo automatico
di quote e saldo, invio del report via email in formato ZIP con allegati, archivio degli ultimi 24 mesi.

## Autenticazione
- Login tramite **Emergent Google OAuth** (genitore 1).
- L'email del genitore 1 viene letta automaticamente dall'account Google e usata come destinatario del report.

## Funzionalità principali
- **Configurazione**: nome genitore 1, nome genitore 2, email genitore 2, % divisione predefinita (50%), giorno saldo (1-28).
- **Blocchi mensili**: lista cronologica (ultimi 24), stato open/closed. Mese corrente creabile in un tap.
- **Spese**: data, descrizione, importo, pagato da, % genitore 1 (chip 0/25/50/75/100 + input), allegato opzionale immagine/PDF (compresso lato client, base64 nel blocco).
- **Chiusura blocco**: direzione bonifico, data, importo, note. ZIP con report.html + allegati, email a entrambi i genitori con oggetto dinamico "Spese extra <Mese> '<AA>".
- **Reinvio email**: solo al genitore 1 dalla pagina del blocco chiuso.
- **Notifiche locali**: 5 avvisi giornalieri nei 5 giorni precedenti il saldo + promemoria il giorno del saldo.
- **Pruning archivio**: backend conserva solo gli ultimi 24 blocchi.

## Stack
Frontend: Expo SDK 57, Expo Router, React Query, lucide-react-native, expo-image-picker/document-picker/image-manipulator, expo-notifications, expo-secure-store.
Backend: FastAPI + Motor (MongoDB), Emergent Resend per email, httpx.

## Testing
Backend: 19/19 test automatici superati (auth, config, blocchi, spese, totali, chiusura con email reale, pruning 24 blocchi).

## Note deployment
Notifiche locali e selezione allegati PDF funzionano al 100% nel build nativo APK. Deploy tramite pulsante "Publish".
