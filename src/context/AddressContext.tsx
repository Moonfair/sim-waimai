import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface AddressInfo {
  recipientName: string;
  phone: string;
  address: string;
}

interface AddressContextType {
  addressInfo: AddressInfo;
  setAddressInfo: (info: AddressInfo) => void;
}

const AddressContext = createContext<AddressContextType | null>(null);

const STORAGE_KEY = 'addressInfo';

const DEFAULT_ADDRESS: AddressInfo = {
  recipientName: '',
  phone: '',
  address: '北京市朝阳区三里屯 三里屯太古里北区 N3-15',
};

function getInitialAddress(): AddressInfo {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_ADDRESS;
  try {
    return { ...DEFAULT_ADDRESS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_ADDRESS;
  }
}

export function AddressProvider({ children }: { children: ReactNode }) {
  const [addressInfo, setAddressInfo] = useState<AddressInfo>(getInitialAddress);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(addressInfo));
  }, [addressInfo]);

  return (
    <AddressContext.Provider value={{ addressInfo, setAddressInfo }}>
      {children}
    </AddressContext.Provider>
  );
}

export function useAddress() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddress must be used within AddressProvider');
  return ctx;
}
