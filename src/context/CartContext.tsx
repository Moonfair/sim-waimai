import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { MenuItem, Restaurant } from '../data/restaurants';

export interface SelectedOption {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

export interface CartItem {
  /** Composite identity: menuItem.id when there are no selected options,
   *  otherwise menuItem.id + selected option ids so different customizations
   *  of the same product become distinct cart lines. */
  key: string;
  menuItem: MenuItem;
  quantity: number;
  selectedOptions?: SelectedOption[];
}

function buildCartItemKey(menuItemId: string, selectedOptions?: SelectedOption[]): string {
  if (!selectedOptions?.length) return menuItemId;
  const sortedIds = [...selectedOptions].map(o => o.optionId).sort().join('|');
  return `${menuItemId}::${sortedIds}`;
}

function optionsPriceDelta(selectedOptions?: SelectedOption[]): number {
  return selectedOptions?.reduce((sum, o) => sum + o.priceDelta, 0) ?? 0;
}

interface CartContextType {
  items: CartItem[];
  restaurant: Restaurant | null;
  addItem: (item: MenuItem, restaurant: Restaurant, selectedOptions?: SelectedOption[]) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  totalCalories: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  const addItem = (menuItem: MenuItem, rest: Restaurant, selectedOptions?: SelectedOption[]) => {
    const key = buildCartItemKey(menuItem.id, selectedOptions);
    if (restaurant && restaurant.id !== rest.id) {
      setItems([{ key, menuItem, quantity: 1, selectedOptions }]);
      setRestaurant(rest);
      return;
    }
    setRestaurant(rest);
    setItems(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) {
        return prev.map(i =>
          i.key === key
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { key, menuItem, quantity: 1, selectedOptions }];
    });
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
  };

  const updateQuantity = (key: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(key);
      return;
    }
    setItems(prev =>
      prev.map(i => i.key === key ? { ...i, quantity } : i)
    );
  };

  const clearCart = () => {
    setItems([]);
    setRestaurant(null);
  };

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce(
    (sum, i) => sum + (i.menuItem.price + optionsPriceDelta(i.selectedOptions)) * i.quantity, 0
  );
  const totalCalories = items.reduce((sum, i) => sum + i.menuItem.calories * i.quantity, 0);

  return (
    <CartContext.Provider value={{
      items, restaurant, addItem, removeItem, updateQuantity, clearCart,
      totalItems, totalPrice, totalCalories,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
