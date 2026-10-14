import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Alert, Platform } from "react-native";
import { api, setOnUnauthorized, setToken } from "@/src/api/client";

WebBrowser.maybeCompleteAuthSession();

type User = { user_id: string; email: string; name: string; picture?: string } | null;

type Ctx = {
  user: User;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

// session_id -> esito dello scambio (evita doppio invio dello stesso session_id)
const pending = new Map<string, Promise<boolean>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const linkCaptured = useRef<string | null>(null);

  const initialUrlRef = useRef<string | null>(null);

  const exchange = useCallback((session_id: string): Promise<boolean> => {
    const existing = pending.get(session_id);
    if (existing) return existing;
    const p = (async () => {
      try {
        const res = await api.authSession(session_id);
        await setToken(res.session_token);
        setUser(res.user);
        return true;
      } catch (e) {
        console.log("auth exchange failed", e);
        return false;
      }
    })();
    pending.set(session_id, p);
    return p;
  }, []);

  useEffect(() => {
    // qualsiasi 401 => torna al login (il gate in _layout gestisce la navigazione)
    setOnUnauthorized(() => setUser(null));
    return () => setOnUnauthorized(null);
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener("url", (ev) => {
      linkCaptured.current = ev.url;
      const sid = extractSessionId(ev.url);
      if (sid) exchange(sid);
    });

    (async () => {
      try {
        const initial = await Linking.getInitialURL();
        initialUrlRef.current = initial;
        const sid = extractSessionId(initial);
        const ok = sid ? await exchange(sid) : false;
        if (ok && Platform.OS === "web") {
          window.history.replaceState(window.history.state, "", window.location.pathname);
        }
        if (!ok) {
          const me = await api.me().catch(() => null);
          setUser((prev) => me?.user ?? prev);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => sub.remove();
  }, [exchange]);

  const signIn = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? window.location.origin + "/"
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      // @ts-ignore
      window.location.href = authUrl;
      return;
    }
    // azzera URL catturati in precedenza: dopo un logout contengono session_id già usati
    linkCaptured.current = null;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null =
      result.type === "success" && (result as any).url ? (result as any).url : null;
    // Android: Custom Tabs può restituire "dismiss" mentre il deep link arriva poco dopo
    for (let i = 0; !url && i < 10; i++) {
      if (linkCaptured.current) url = linkCaptured.current;
      else await sleep(200);
    }
    if (!url) {
      const init = await Linking.getInitialURL();
      if (init && init !== initialUrlRef.current) url = init;
    }
    const sid = extractSessionId(url);
    if (!sid) return; // annullato dall'utente
    const ok = await exchange(sid);
    if (!ok) {
      Alert.alert("Accesso non riuscito", "Non è stato possibile completare l'accesso con Google. Riprova.");
    }
  }, [exchange]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
