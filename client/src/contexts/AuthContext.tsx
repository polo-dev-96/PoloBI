import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { queryClient } from "@/lib/queryClient";

interface User {
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "polo-bi-auth";

function savedToken(): string | null {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(AUTH_STORAGE_KEY) || "null",
    );
    if (
      saved &&
      typeof saved === "object" &&
      "token" in saved &&
      typeof saved.token === "string" &&
      /^[a-f0-9]{64}$/.test(saved.token)
    )
      return saved.token;
  } catch {
    /* Uma sessão ilegível precisa de um novo login. */
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const revision = useRef(0);
  const clearSession = useCallback(() => {
    revision.current++;
    setUser(null);
    setToken(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    void queryClient.cancelQueries({ queryKey: ["openai"] });
    queryClient.removeQueries({ queryKey: ["openai"] });
  }, []);

  useEffect(() => {
    let controller: AbortController | undefined;
    const restore = async () => {
      controller?.abort();
      controller = new AbortController();
      const current = ++revision.current;
      const storedToken = savedToken();
      if (!storedToken) {
        clearSession();
        setIsLoading(false);
        return;
      }
      try {
        const response = await fetch("/api/auth/verify", {
          headers: { Authorization: `Bearer ${storedToken}` },
          signal: controller.signal,
        });
        if (current !== revision.current) return;
        if (!response.ok) {
          clearSession();
          return;
        }
        const data: { valid: boolean; user?: User } = await response.json();
        if (current !== revision.current) return;
        if (data.valid && data.user?.role === "admin") {
          setUser(data.user);
          setToken(storedToken);
        } else clearSession();
      } catch {
        // Sem conexão, manter apenas uma sessão que já foi validada nesta aba.
      } finally {
        if (current === revision.current || !savedToken()) setIsLoading(false);
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === AUTH_STORAGE_KEY || event.key === null) {
        setUser(null);
        setToken(null);
        void queryClient.cancelQueries({ queryKey: ["openai"] });
        queryClient.removeQueries({ queryKey: ["openai"] });
        void restore();
      }
    };
    const focus = () => {
      void restore();
    };
    void restore();
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    return () => {
      revision.current++;
      controller?.abort();
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
    };
  }, [clearSession]);

  const login = async (
    email: string,
    password: string,
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.success && data.token && data.user) {
        revision.current++;
        setUser(data.user);
        setToken(data.token);
        setIsLoading(false);
        localStorage.setItem(
          AUTH_STORAGE_KEY,
          JSON.stringify({
            user: data.user,
            token: data.token,
          }),
        );
        return { success: true };
      } else {
        return {
          success: false,
          message: data.message || "Erro ao fazer login",
        };
      }
    } catch (error) {
      return { success: false, message: "Erro de conexão com o servidor" };
    }
  };

  const logout = useCallback(() => {
    const storedToken = savedToken();
    clearSession();
    setIsLoading(false);
    if (storedToken)
      void fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${storedToken}` },
      }).catch(() => {});
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
