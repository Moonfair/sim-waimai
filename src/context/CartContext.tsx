import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { MenuItem, Restaurant } from '../data/restaurants';

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  restaurant: Restaurant | null;
  addItem: (item: MenuItem, restaurant: Restaurant) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  totalCalories: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  const addItem = (menuItem: MenuItem, rest: Restaurant) => {
    if (restaurant && restaurant.id !== rest.id) {
      setItems([{ menuItem, quantity: 1 }]);
      setRestaurant(rest);
      return;
    }
    setRestaurant(rest);
    setItems(prev => {
      const existing = prev.find(i => i.menuItem.id === menuItem.id);
      if (existing) {
        return prev.map(i =>
          i.menuItem.id === menuItem.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { menuItem, quantity: 1 }];
    });
  };

  const removeItem = (itemId: string) => {
    setItems(prev => prev.filter(i => i.menuItem.id !== itemId));
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(itemId);
      return;
    }
    setItems(prev =>
      prev.map(i => i.menuItem.id === itemId ? { ...i, quantity } : i)
    );
  };

  const clearCart = () => {
    setItems([]);
    setRestaurant(null);
  };

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.menuItem.price * i.quantity, 0);
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
