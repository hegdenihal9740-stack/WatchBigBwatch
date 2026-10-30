import { useSyncExternalStore } from "react";
import { watches, watchPrices } from "@/lib/watches";
import { isSupabaseConfigured } from "@/lib/supabase-config";

export const prices = watchPrices as Record<string, number>;
export type CartItem = { id: string; qty: number };
export const getProductPrice = (id: string): number | undefined => {
  const price = prices[id];
  return typeof price === "number" && Number.isSafeInteger(price) && price > 0 ? price : undefined;
};

const BASE = "private-flight-cart";
let userKey = "guest";
const keyFor = (u: string) => `${BASE}:${u}`;
let items: CartItem[] = [];
let loaded = false;
let openState = false;
const listeners = new Set<() => void>();
const emit = () => {
  listeners.forEach((l) => l());
};
const save = () => {
  try {
    localStorage.setItem(keyFor(userKey), JSON.stringify(items));
  } catch {
    /* storage unavailable */
  }
};
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(id);
const normalizeItems = (value: unknown): CartItem[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, number>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || !("id" in entry) || !("qty" in entry))
      continue;
    const { id, qty } = entry;
    if (!validId(id) || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    byId.set(id, Math.min(20, Math.max(byId.get(id) ?? 0, qty)));
  }
  return [...byId].map(([id, qty]) => ({ id, qty }));
};
const readFor = (u: string): CartItem[] => {
  try {
    return normalizeItems(JSON.parse(localStorage.getItem(keyFor(u)) ?? "[]") as unknown);
  } catch {
    return [];
  }
};
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveRemote = (u: string, snapshot: CartItem[]) => {
  if (u === "guest") return;
  const previousTimer = syncTimers.get(u);
  if (previousTimer) clearTimeout(previousTimer);
  const timer = setTimeout(() => {
    syncTimers.delete(u);
    if (userKey !== u) return;
    void import("@/integrations/supabase/client")
      .then(async ({ supabase }) => {
        if (userKey !== u) return;
        const { error } = await supabase.from("customer_carts").upsert({
          user_id: u,
          items: snapshot,
          updated_at: new Date().toISOString(),
        });
        if (error) console.error("Could not sync your cart to your account.", error);
      })
      .catch((error: unknown) => console.error("Could not sync your cart to your account.", error));
  }, 250);
  syncTimers.set(u, timer);
};
const persist = () => {
  save();
  saveRemote(userKey, items);
};
let revision = 0;
const switchUser = (u: string) => {
  if (u === userKey) return;
  userKey = u;
  items = readFor(u);
  const startRevision = revision;
  emit();
  if (u === "guest") return;
  void import("@/integrations/supabase/client")
    .then(async ({ supabase }) => {
      const { data, error } = await supabase
        .from("customer_carts")
        .select("items")
        .eq("user_id", u)
        .maybeSingle();
      if (error) throw error;
      if (userKey !== u) return;
      if (revision !== startRevision) {
        saveRemote(u, items);
        return;
      }
      if (data) {
        items = normalizeItems(data.items);
        save();
        emit();
      } else if (items.length) {
        saveRemote(u, items);
      }
    })
    .catch((error: unknown) => console.error("Could not restore your saved cart.", error));
};
const load = () => {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    localStorage.removeItem(BASE);
  } catch {
    /* ignore old shared cart */
  }
  items = readFor(userKey);
  if (!isSupabaseConfigured()) return;
  void import("@/integrations/supabase/client")
    .then(({ supabase }) => {
      void supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (error) throw error;
          switchUser(data.session?.user.id ?? "guest");
        })
        .catch((error: unknown) =>
          console.error("Could not identify the account for cart sync.", error),
        );
      supabase.auth.onAuthStateChange((_e, session) => switchUser(session?.user.id ?? "guest"));
    })
    .catch((error: unknown) => console.error("Could not initialize cart sync.", error));
};

export const cart = {
  add(id: string) {
    load();
    if (!validId(id)) return;
    const f = items.find((i) => i.id === id);
    items = f
      ? items.map((i) => (i.id === id ? { ...i, qty: Math.min(20, i.qty + 1) } : i))
      : [...items, { id, qty: 1 }];
    openState = true;
    revision += 1;
    persist();
    emit();
  },
  setQty(id: string, qty: number) {
    if (!validId(id) || !Number.isFinite(qty)) return;
    items =
      qty <= 0
        ? items.filter((i) => i.id !== id)
        : items.map((i) => (i.id === id ? { ...i, qty: Math.min(20, Math.floor(qty)) } : i));
    revision += 1;
    persist();
    emit();
  },
  clear() {
    items = [];
    revision += 1;
    persist();
    emit();
  },
  setOpen(v: boolean) {
    openState = v;
    emit();
  },
};

const subscribe = (l: () => void) => {
  load();
  listeners.add(l);
  queueMicrotask(l);
  return () => {
    listeners.delete(l);
  };
};
const EMPTY: CartItem[] = [];
export function useCart() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
  const open = useSyncExternalStore(
    subscribe,
    () => openState,
    () => false,
  );
  return {
    items: list,
    open,
    count: list.reduce((s, i) => s + i.qty, 0),
    total: list.reduce((s, i) => s + i.qty * (getProductPrice(i.id) ?? 0), 0),
    hasUnavailablePrice: list.some((i) => getProductPrice(i.id) === undefined),
    hasUnavailableProduct: list.some((i) => !watches.some((watch) => watch.id === i.id)),
  };
}

export const formatPrice = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
