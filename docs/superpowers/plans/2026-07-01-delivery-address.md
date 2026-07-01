# 收货地址填写功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded fake delivery address on the Home page and Cart page with a shared, user-editable address (recipient name / phone / address text), edited via a shared bottom-sheet, and delete the dead "搜索餐厅或菜品" placeholder block on the Home page.

**Architecture:** A new `AddressContext` (parallel to the existing `CartContext`, not merged into it — `clearCart()` must not wipe the address) holds `{ recipientName, phone, address }` in memory. A new `AddressEditSheet` bottom-sheet component (visually modeled on the existing `MenuItemOptionsSheet`) edits a local draft and commits it back to the context on save. Both `Home.tsx` and `Cart.tsx` read from the context and open the same sheet.

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind CSS, React Router v6, plain React Context (no Redux/Zustand). No test framework exists in this repo (no `test`/`vitest`/`jest` script) — verification is `tsc --noEmit` / `npm run lint` / `npm run build` plus manual browser testing via `npm run dev`, consistent with how the customization-options feature was verified.

## Global Constraints

- Single "current address" only — no address book / multiple saved addresses.
- Fields: `recipientName` (text), `phone` (text), `address` (free text, no province/city/district structuring).
- State is in-memory only (`useState` in a Context Provider) — no `localStorage`, matching how `CartContext` already behaves (resets on page refresh).
- Default values: `recipientName: ''`, `phone: ''`, `address: '北京市朝阳区三里屯 三里屯太古里北区 N3-15'` (carries over the existing fake address text; recipient/phone start empty with input placeholders).
- The edit sheet must show this exact disclaimer line: "以上信息仅保存在本机浏览器中，不会上传到任何服务器".
- Reuse existing visual conventions: bottom-sheet chrome from `src/components/MenuItemOptionsSheet.tsx` (backdrop `fixed inset-0 bg-black/40` + panel `fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white rounded-t-2xl`), and input styling from the Cart notes `<textarea>` (`border border-gray-100 rounded-lg p-2.5 text-sm ... outline-none focus:border-orange-300`).
- Delete `src/pages/Home.tsx:36-40` (the dead search placeholder) — confirmed via grep to have zero other references anywhere in the codebase.

---

### Task 1: `AddressContext`

**Files:**
- Create: `src/context/AddressContext.tsx`

**Interfaces:**
- Produces: `AddressInfo` type (`{ recipientName: string; phone: string; address: string }`), `AddressProvider` component, `useAddress()` hook returning `{ addressInfo: AddressInfo; setAddressInfo: (info: AddressInfo) => void }`.

- [ ] **Step 1: Write the context file**

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `AddressContext.tsx` (the file isn't imported anywhere yet, so it just needs to compile standalone).

- [ ] **Step 3: Commit**

```bash
git add src/context/AddressContext.tsx
git commit -m "Add AddressContext for shared editable delivery address"
```

---

### Task 2: `AddressEditSheet` component

**Files:**
- Create: `src/components/AddressEditSheet.tsx`

**Interfaces:**
- Consumes: `useAddress()` and `AddressInfo` from `src/context/AddressContext.tsx` (Task 1).
- Produces: default-exported `AddressEditSheet` component with props `{ onClose: () => void }`.

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { useAddress } from '../context/AddressContext';
import type { AddressInfo } from '../context/AddressContext';

interface Props {
  onClose: () => void;
}

export default function AddressEditSheet({ onClose }: Props) {
  const { addressInfo, setAddressInfo } = useAddress();
  const [draft, setDraft] = useState<AddressInfo>(addressInfo);

  const handleSave = () => {
    setAddressInfo(draft);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50 bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
          <span className="font-bold text-gray-900 text-sm">收货信息</span>
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 text-lg"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">收件人</label>
            <input
              type="text"
              className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-700 outline-none focus:border-orange-300"
              placeholder="请填写收件人姓名"
              value={draft.recipientName}
              onChange={(e) => setDraft({ ...draft, recipientName: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">手机号</label>
            <input
              type="tel"
              className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-700 outline-none focus:border-orange-300"
              placeholder="请填写手机号"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">收货地址</label>
            <textarea
              className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-700 resize-none outline-none focus:border-orange-300"
              rows={2}
              placeholder="请填写详细收货地址"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          </div>
        </div>

        <div className="px-4 pb-8 pt-3 border-t border-gray-100">
          <p className="text-gray-300 text-xs text-center mb-2">
            以上信息仅保存在本机浏览器中，不会上传到任何服务器
          </p>
          <button
            className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform"
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (component isn't rendered anywhere yet, but must compile standalone).

- [ ] **Step 3: Commit**

```bash
git add src/components/AddressEditSheet.tsx
git commit -m "Add AddressEditSheet bottom-sheet for editing delivery address"
```

---

### Task 3: Wire `AddressProvider` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AddressProvider` from `src/context/AddressContext.tsx` (Task 1).

- [ ] **Step 1: Add the import and wrap the routes**

Current file:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CartProvider } from './context/CartContext';
import Home from './pages/Home';
import Restaurant from './pages/Restaurant';
import Cart from './pages/Cart';
import Order from './pages/Order';
import Tracking from './pages/Tracking';
import Done from './pages/Done';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <CartProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/restaurant/:id" element={<Restaurant />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/order" element={<Order />} />
          <Route path="/tracking" element={<Tracking />} />
          <Route path="/done" element={<Done />} />
        </Routes>
      </CartProvider>
    </BrowserRouter>
  );
}
```

Replace with:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CartProvider } from './context/CartContext';
import { AddressProvider } from './context/AddressContext';
import Home from './pages/Home';
import Restaurant from './pages/Restaurant';
import Cart from './pages/Cart';
import Order from './pages/Order';
import Tracking from './pages/Tracking';
import Done from './pages/Done';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AddressProvider>
        <CartProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/restaurant/:id" element={<Restaurant />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/order" element={<Order />} />
            <Route path="/tracking" element={<Tracking />} />
            <Route path="/done" element={<Done />} />
          </Routes>
        </CartProvider>
      </AddressProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "Wire AddressProvider into the app"
```

---

### Task 4: Update `Home.tsx` — remove dead search, wire live address bar

**Files:**
- Modify: `src/pages/Home.tsx`

**Interfaces:**
- Consumes: `useAddress()` from Task 1, `AddressEditSheet` from Task 2.

- [ ] **Step 1: Update imports and add local state**

Current imports/top of component:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restaurants, CATEGORIES } from '../data/restaurants';
import type { Category } from '../data/restaurants';
import RestaurantCard from '../components/RestaurantCard';
import { useCart } from '../context/CartContext';

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<Category>('全部');
  const { totalItems, totalPrice, restaurant: cartRestaurant } = useCart();
  const navigate = useNavigate();
```

Replace with:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restaurants, CATEGORIES } from '../data/restaurants';
import type { Category } from '../data/restaurants';
import RestaurantCard from '../components/RestaurantCard';
import { useCart } from '../context/CartContext';
import { useAddress } from '../context/AddressContext';
import AddressEditSheet from '../components/AddressEditSheet';

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<Category>('全部');
  const { totalItems, totalPrice, restaurant: cartRestaurant } = useCart();
  const { addressInfo } = useAddress();
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const navigate = useNavigate();
```

- [ ] **Step 2: Replace the address bar + delete the search block**

Current:

```tsx
        {/* Address bar */}
        <div className="bg-white/20 rounded-xl mt-3 px-3 py-2.5 flex items-center gap-2">
          <span className="text-white text-sm">📍</span>
          <span className="text-white text-sm font-medium">北京市朝阳区三里屯</span>
          <span className="text-white/60 text-xs ml-auto">预计25-40分钟</span>
        </div>

        {/* Search */}
        <div className="bg-white rounded-xl mt-2 px-3 py-2.5 flex items-center gap-2">
          <span className="text-gray-400">🔍</span>
          <span className="text-gray-400 text-sm">搜索餐厅或菜品</span>
        </div>
```

Replace with:

```tsx
        {/* Address bar */}
        <div
          className="bg-white/20 rounded-xl mt-3 px-3 py-2.5 flex items-center gap-2 cursor-pointer"
          onClick={() => setAddressSheetOpen(true)}
        >
          <span className="text-white text-sm">📍</span>
          <span className="text-white text-sm font-medium">{addressInfo.address}</span>
          <span className="text-white/60 text-xs ml-auto">预计25-40分钟</span>
        </div>
```

- [ ] **Step 3: Render the sheet conditionally at the end of the component**

Find the end of the component (just before the closing `</div>` of the top-level `app-container`, i.e. right after the "Bottom cart bar" block's closing `)}`):

```tsx
      {/* Bottom cart bar if items */}
      {totalItems > 0 && cartRestaurant && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-6">
          {/* ... unchanged ... */}
        </div>
      )}
    </div>
  );
}
```

Insert the sheet render between the cart bar block and the closing `</div>`:

```tsx
      {/* Bottom cart bar if items */}
      {totalItems > 0 && cartRestaurant && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-6">
          {/* ... unchanged ... */}
        </div>
      )}

      {addressSheetOpen && (
        <AddressEditSheet onClose={() => setAddressSheetOpen(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "Wire Home address bar to AddressContext, remove dead search placeholder"
```

---

### Task 5: Update `Cart.tsx` — wire live address card

**Files:**
- Modify: `src/pages/Cart.tsx`

**Interfaces:**
- Consumes: `useAddress()` from Task 1, `AddressEditSheet` from Task 2.

- [ ] **Step 1: Update imports and add local state**

Current imports/top of component:

```tsx
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export default function Cart() {
  const { items, restaurant, totalPrice, totalCalories, updateQuantity, clearCart } = useCart();
  const navigate = useNavigate();
```

Replace with:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAddress } from '../context/AddressContext';
import AddressEditSheet from '../components/AddressEditSheet';

export default function Cart() {
  const { items, restaurant, totalPrice, totalCalories, updateQuantity, clearCart } = useCart();
  const { addressInfo } = useAddress();
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const navigate = useNavigate();
```

- [ ] **Step 2: Replace the hardcoded address card**

Current:

```tsx
        {/* Delivery address */}
        <div className="bg-white rounded-xl mt-4 p-4">
          <div className="flex items-start gap-3">
            <span className="text-orange-500 text-lg mt-0.5">📍</span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">北京市朝阳区三里屯</span>
                <span className="text-gray-300 text-xs">›</span>
              </div>
              <p className="text-gray-400 text-xs mt-0.5">三里屯太古里北区 N3-15（假地址）</p>
              <p className="text-gray-400 text-xs mt-0.5">联系电话：138****1234</p>
            </div>
          </div>
          <div className="mt-3 bg-orange-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-orange-400 text-sm">⏱️</span>
            <span className="text-orange-500 text-xs font-medium">预计 {restaurant.deliveryTime} 分钟后送达（假的）</span>
          </div>
        </div>
```

Replace with:

```tsx
        {/* Delivery address */}
        <div
          className="bg-white rounded-xl mt-4 p-4 cursor-pointer"
          onClick={() => setAddressSheetOpen(true)}
        >
          <div className="flex items-start gap-3">
            <span className="text-orange-500 text-lg mt-0.5">📍</span>
            <div className="flex-1">
              {addressInfo.recipientName && addressInfo.phone ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-900 text-sm">
                      {addressInfo.recipientName} {addressInfo.phone}
                    </span>
                    <span className="text-gray-300 text-xs">›</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-0.5">{addressInfo.address}</p>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">点击填写收货信息</span>
                  <span className="text-gray-300 text-xs">›</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 bg-orange-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-orange-400 text-sm">⏱️</span>
            <span className="text-orange-500 text-xs font-medium">预计 {restaurant.deliveryTime} 分钟后送达（假的）</span>
          </div>
        </div>
```

- [ ] **Step 3: Render the sheet conditionally at the end of the component**

Find the end of the component (the "Bottom CTA" block near the end, right before the final closing `</div>` of `app-container`):

```tsx
      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-8 pt-4 bg-gradient-to-t from-gray-50 via-gray-50">
        {/* ... unchanged ... */}
      </div>
    </div>
  );
}
```

Insert the sheet render between the bottom CTA block and the closing `</div>`:

```tsx
      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-8 pt-4 bg-gradient-to-t from-gray-50 via-gray-50">
        {/* ... unchanged ... */}
      </div>

      {addressSheetOpen && (
        <AddressEditSheet onClose={() => setAddressSheetOpen(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Cart.tsx
git commit -m "Wire Cart address card to AddressContext"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, and build**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three exit 0 with no new errors/warnings beyond the single pre-existing `react(only-export-components)` warning on `src/context/CartContext.tsx` (already present before this feature; unrelated).

- [ ] **Step 2: Manual smoke test via `npm run dev`**

Run `npm run dev`, open the printed local URL, and check:
1. Home page top address bar shows "北京市朝阳区三里屯 三里屯太古里北区 N3-15" and is clickable, opening the edit sheet.
2. The "搜索餐厅或菜品" box is gone from the Home page; category tabs and restaurant grid below it are unaffected.
3. Fill in 收件人/手机号/收货地址 in the sheet, tap "保存" — Home page address bar text updates immediately to the new address.
4. Add an item to cart, go to `/cart` — the address card shows the same recipient name + phone (bold line) and address (gray line) just entered.
5. Tap the Cart address card, edit again, save — both the Cart page and (after navigating back) the Home page reflect the new value, confirming shared state rather than per-page state.
6. Clear the recipient name and phone (leave blank) and save — Cart page address card falls back to showing "点击填写收货信息" instead of blank lines.
7. Refresh the browser — address resets to the default fake value (in-memory only, no persistence), matching how the cart already behaves.

- [ ] **Step 3: Commit if any fixes were needed during manual testing**

```bash
git add -A
git commit -m "Fix issues found during address feature manual verification"
```

(Skip this step if no fixes were needed.)
