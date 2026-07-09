import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserDto } from '@sim-waimai/shared';
import { api } from '../lib/api';

interface AuthContextType {
  user: UserDto | null;
  /** True while the initial /auth/me bootstrap is in flight. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
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
    setUser(await api.post<UserDto>('/auth/login', { username, password }));
  };

  const register = async (username: string, password: string) => {
    setUser(await api.post<UserDto>('/auth/register', { username, password }));
  };

  const logout = async () => {
    await api.post('/auth/logout');
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
