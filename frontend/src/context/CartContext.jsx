import { createContext, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const KEY = "gudang_cart_v1";

export function CartProvider({ children }) {
  const [lines, setLines] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines]);

  const setQty = (item, qty) =>
    setLines((prev) => {
      const others = prev.filter((l) => l.item_id !== item.id);
      if (qty <= 0) return others;
      return [...others, {
        item_id: item.id, name: item.name, category: item.category,
        item_code: item.item_code, photo: item.photo, max: item.quantity, qty,
      }];
    });

  const qtyOf = (itemId) => lines.find((l) => l.item_id === itemId)?.qty || 0;
  const totalQty = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);
  const clear = () => setLines([]);

  return (
    <CartContext.Provider value={{ lines, setQty, qtyOf, totalQty, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
