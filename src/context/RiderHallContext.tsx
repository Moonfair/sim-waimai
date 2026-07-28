import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  RiderHallGrabResultDto,
  RiderHallOrderPreviewDto,
  RiderHallPendingDto,
} from '@sim-waimai/shared';
import { useAuth } from './AuthContext';
import { api, ApiError } from '../lib/api';

const GRAB_COOLDOWN_MS = 10_000;

export type PreviewResult =
  | { ok: true; preview: RiderHallOrderPreviewDto }
  | { ok: false; reason: 'empty' | 'error' };

export type AcceptResult =
  | { ok: true; result: RiderHallGrabResultDto }
  | { ok: false; reason: 'taken' | 'error' };

interface RiderHallContextType {
  pendingCount: number;
  cooldownActive: boolean;
  previewLatest: () => Promise<PreviewResult>;
  acceptOrder: (orderId: string) => Promise<AcceptResult>;
}

const RiderHallContext = createContext<RiderHallContextType | null>(null);

export function RiderHallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [cooldownActive, setCooldownActive] = useState(false);
  const cooldownRef = useRef(false);

  const refetch = useCallback(() => {
    api
      .get<RiderHallPendingDto>('/rider-hall/pending')
      .then((d) => setPendingCount(d.count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }
    refetch();
    const es = new EventSource('/api/rider-hall/stream', { withCredentials: true });
    es.addEventListener('changed', refetch);
    es.onerror = () => {}; // EventSource auto-reconnects on its own
    return () => es.close();
  }, [user, refetch]);

  const previewLatest = useCallback(async (): Promise<PreviewResult> => {
    try {
      const preview = await api.get<RiderHallOrderPreviewDto>('/rider-hall/preview');
      return { ok: true, preview };
    } catch (err) {
      return { ok: false, reason: err instanceof ApiError && err.status === 404 ? 'empty' : 'error' };
    }
  }, []);

  const acceptOrder = useCallback(async (orderId: string): Promise<AcceptResult> => {
    if (cooldownRef.current) return { ok: false, reason: 'error' };
    cooldownRef.current = true;
    setCooldownActive(true);
    setTimeout(() => {
      cooldownRef.current = false;
      setCooldownActive(false);
    }, GRAB_COOLDOWN_MS);

    try {
      const result = await api.post<RiderHallGrabResultDto>('/rider-hall/grab', { orderId });
      setPendingCount((c) => Math.max(0, c - 1));
      return { ok: true, result };
    } catch (err) {
      return { ok: false, reason: err instanceof ApiError && err.status === 409 ? 'taken' : 'error' };
    }
  }, []);

  return (
    <RiderHallContext.Provider value={{ pendingCount, cooldownActive, previewLatest, acceptOrder }}>
      {children}
    </RiderHallContext.Provider>
  );
}

export function useRiderHall() {
  const ctx = useContext(RiderHallContext);
  if (!ctx) throw new Error('useRiderHall must be used within RiderHallProvider');
  return ctx;
}
