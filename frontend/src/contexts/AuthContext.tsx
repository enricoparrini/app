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
import { Platform } from "react-native";
import { api, setToken } from "@/src/api/client";

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

const sentIds = new Set<string>();

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const linkCaptured = useRef<string | null>(null);

  const exchange = useCallback(async (session_id: string) => {
    if (sentIds.has(session_id)) return;
    sentIds.add(session_id);
    try {
      const res = await api.authSession(session_id);
      await setToken(res.session_token);
      setUser(res.user);
    } catch (e) {
      console.log("auth exchange failed", e);
    }
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
        const sid = extractSessionId(initial);
        if (sid) await exchange(sid);
        const me = await api.me().catch(() => null);
        if (me?.user) setUser(me.user);
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
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null = null;
    if (result.type === "success" && (result as any).url) {
      url = (result as any).url;
    }
    if (!url && linkCaptured.current) url = linkCaptured.current;
    if (!url) url = await Linking.getInitialURL();
    const sid = extractSessionId(url);
    if (sid) await exchange(sid);
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
