import { createContext, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const KEY = "gudang_cart_v2";
const WIN_KEY = "gudang_window_v1";

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

export function CartProvider({ children }) {
  const [lines, setLines] = useState(() => read(KEY, []));
  const [window, setWindowState] = useState(() =>
    read(WIN_KEY, { pickup_date: "", duration_type: "hours", duration_hours: 8, return_date: "" }));

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(lines)); }, [lines]);
  useEffect(() => { localStorage.setItem(WIN_KEY, JSON.stringify(window)); }, [window]);

  const setQty = (item, qty) =>
    setLines((prev) => {
      const others = prev.filter((l) => l.item_id !== item.id);
      if (qty <= 0) return others;
      return [...others, {
        item_id: item.id, name: item.name, category: item.category,
        item_code: item.item_code, photo: item.photo, max: item.quantity, qty,
      }];
    });

  const addLines = (incoming) =>
    setLines((prev) => {
      const map = new Map(prev.map((l) => [l.item_id, l]));
      incoming.forEach((l) => {
        map.set(l.item_id, {
          item_id: l.item_id, name: l.name, category: l.category, item_code: l.item_code,
          photo: l.photo, max: l.max, qty: l.qty,
        });
      });
      return [...map.values()];
    });

  const setWindow = (w) => setWindowState((prev) => ({ ...prev, ...w }));
  const qtyOf = (itemId) => lines.find((l) => l.item_id === itemId)?.qty || 0;
  const totalQty = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);
  const clear = () => setLines([]);

  return (
    <CartContext.Provider value={{ lines, setQty, addLines, qtyOf, totalQty, clear, window, setWindow }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
