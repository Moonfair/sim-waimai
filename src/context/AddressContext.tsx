import { createContext, useContext, useState } from 'react';
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

const DEFAULT_ADDRESS: AddressInfo = {
  recipientName: '',
  phone: '',
  address: '北京市朝阳区三里屯 三里屯太古里北区 N3-15',
};

export function AddressProvider({ children }: { children: ReactNode }) {
  const [addressInfo, setAddressInfo] = useState<AddressInfo>(DEFAULT_ADDRESS);

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
