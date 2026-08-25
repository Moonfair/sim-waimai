import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserDto } from '@sim-waimai/shared';
import { api, setStoredToken } from '../lib/api';
import { getDeviceId } from '../lib/deviceFingerprint';

/** Present only when the API responded to a cross-origin (Toy) client — see api.ts. */
type AuthResponse = UserDto & { token?: string };

interface AuthContextType {
  user: UserDto | null;
  /** True while the initial /auth/me bootstrap is in flight. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    captchaToken: string,
    captchaAnswer: number,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<UserDto>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const deviceId = await getDeviceId();
    const res = await api.post<AuthResponse>('/auth/login', { username, password, deviceId });
    setStoredToken(res.token ?? null);
    setUser(res);
  };

  const register = async (
    username: string,
    password: string,
    captchaToken: string,
    captchaAnswer: number,
  ) => {
    const deviceId = await getDeviceId();
    const res = await api.post<AuthResponse>('/auth/register', {
      username,
      password,
      captchaToken,
      captchaAnswer,
      deviceId,
    });
    setStoredToken(res.token ?? null);
    setUser(res);
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setStoredToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
