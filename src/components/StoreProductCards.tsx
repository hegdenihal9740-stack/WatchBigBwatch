import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ScanLine, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { cart, getProductPrice } from "@/lib/cart";
import { watches, type WatchTone } from "@/lib/watches";
import { ensureProducts, isBuiltIn } from "@/lib/products";
import { cardMeta as meta } from "@/lib/watch-meta";

const usd = (n: number) => n.toLocaleString("en-IN");

function Stars({ value }: { value: number }) {
  return (
    <span className="store-card-stars" aria-label={`${value} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="store-card-star">
            <Star size={15} className="store-card-star-bg" />
            <span style={{ width: `${fill * 100}%` }}>
              <Star size={15} fill="currentColor" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function WatchProductCard({ tone }: { tone: WatchTone }) {
  const w = watches.find((x) => x.id === tone);
  if (!w) return null;
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const m = meta[w.id];
  const price = getProductPrice(w.id);
  const off = price === undefined ? 0 : Math.round((1 - price / m.list) * 100);
  return (
    <article className="store-card-card">
      {m.badge && <span className="store-card-badge">{m.badge}</span>}
      <Link to="/shop/$watchId" params={{ watchId: w.id }} className="store-card-img">
        <img src={w.image} alt={w.name} loading="lazy" />
      </Link>
      <div className="store-card-body">
        <p className="store-card-eyebrow">BIG-B · {w.finish}</p>
        <Link to="/shop/$watchId" params={{ watchId: w.id }} className="store-card-title">
          {w.name}
        </Link>
        <p className="store-card-specs">{m.specs.join(" · ")}</p>
        <div className="store-card-price-row">
          <span className="store-card-price">
            ₹{price === undefined ? "Unavailable" : usd(price)}
          </span>
          <s className="store-card-muted">₹{usd(m.list)}</s>
          <span className="store-card-off">−{off}%</span>
        </div>
        <div className="store-card-rating">
          <Stars value={m.rating} />
          <span>{m.rating}</span>
          <span className="store-card-muted">({usd(m.reviews)})</span>
        </div>
        <p className="store-card-small store-card-muted">
          Delivered by {tomorrow}
          {m.stock ? ` · only ${m.stock} left` : ""}
        </p>
        <div className="store-card-links">
          {isBuiltIn(w.id) && (
            <Link
              to="/watches/$watchId"
              params={{ watchId: w.id }}
              search={{ tryon: true }}
              className="store-card-tryon"
            >
              <ScanLine size={14} /> Try on
            </Link>
          )}
          <Link to="/shop/$watchId" params={{ watchId: w.id }} className="store-card-more">
            Details
          </Link>
        </div>
        <button
          type="button"
          className="store-card-add"
          disabled={price === undefined}
          onClick={() => {
            cart.add(w.id);
            toast.success(`${w.name} added to cart`);
          }}
        >
          Add to cart
        </button>
      </div>
    </article>
  );
}

const filters: { id: "all" | WatchTone; label: string }[] = [
  { id: "all", label: "All" },
  { id: "steel", label: "Stainless Steel" },
  { id: "black", label: "Midnight Black" },
  { id: "gold", label: "Classic Gold" },
  { id: "rosegold", label: "Rose Gold" },
];
type Sort = "popular" | "low" | "high" | "rating" | "new";

export function StoreProductCards() {
  const [filter, setFilter] = useState<"all" | WatchTone>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [catalog, setCatalog] = useState([...watches]);
  const [catalogError, setCatalogError] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const catalogRequest = useRef(false);
  const mounted = useRef(true);
  const refreshCatalog = useCallback(async () => {
    if (catalogRequest.current) return;
    catalogRequest.current = true;
    setLoadingCatalog(true);
    try {
      const loaded = await ensureProducts(true);
      if (!mounted.current) return;
      if (!loaded) {
        setCatalogError("Products could not be refreshed. Check your connection and try again.");
        return;
      }
      setCatalogError("");
      setCatalog([...watches]);
    } catch (error) {
      console.error("[Products] Could not refresh the collection", error);
      if (mounted.current) {
        setCatalogError("Products could not be refreshed. Check your connection and try again.");
      }
    } finally {
      catalogRequest.current = false;
      if (mounted.current) setLoadingCatalog(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCatalog();
    };
    void refreshCatalog();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshCatalog]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const found = [...new Map(catalog.map((watch) => [watch.id, watch])).values()]
      .map((w, i) => ({ w, i }))
      .filter(
        ({ w }) =>
          (filter === "all" || w.id === filter) &&
          (!term ||
            [w.name, w.finish, ...w.details, ...(meta[w.id]?.specs ?? [])]
              .join(" ")
              .toLowerCase()
              .includes(term)),
      );
    const by: Record<Sort, (a: (typeof found)[number], b: (typeof found)[number]) => number> = {
      popular: (a, b) => meta[b.w.id].reviews - meta[a.w.id].reviews,
      low: (a, b) =>
        (getProductPrice(a.w.id) ?? Number.MAX_SAFE_INTEGER) -
        (getProductPrice(b.w.id) ?? Number.MAX_SAFE_INTEGER),
      high: (a, b) =>
        (getProductPrice(b.w.id) ?? Number.MAX_SAFE_INTEGER) -
        (getProductPrice(a.w.id) ?? Number.MAX_SAFE_INTEGER),
      rating: (a, b) => meta[b.w.id].rating - meta[a.w.id].rating,
      new: (a, b) => b.i - a.i,
    };
    return found.sort(by[sort]).map(({ w }) => w);
  }, [catalog, filter, q, sort]);
  return (
    <section className="store-card-section" aria-labelledby="store-card-title">
      <h2 id="store-card-title">Shop the collection</h2>
      {catalogError && (
        <p className="store-card-muted" role="alert">
          {catalogError}{" "}
          <button
            type="button"
            className="store-card-chip"
            disabled={loadingCatalog}
            onClick={() => void refreshCatalog()}
          >
            {loadingCatalog ? "Refreshing…" : "Try again"}
          </button>
        </p>
      )}
      <div className="store-card-tools">
        <label className="store-card-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search name, finish, features…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search watches"
          />
        </label>
        <select
          className="store-card-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort by"
        >
          <option value="popular">Popularity</option>
          <option value="low">Price: Low to High</option>
          <option value="high">Price: High to Low</option>
          <option value="rating">Top rated</option>
          <option value="new">Newest</option>
        </select>
      </div>
      <div className="store-card-chips" role="radiogroup" aria-label="Finish">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            className={`store-card-chip ${filter === f.id ? "is-on" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="store-card-grid">
          {list.map((w) => (
            <WatchProductCard key={w.id} tone={w.id} />
          ))}
        </div>
      ) : (
        <p className="store-card-muted">
          No watches match.{" "}
          <button
            type="button"
            className="store-card-chip"
            onClick={() => {
              setQ("");
              setFilter("all");
            }}
          >
            Clear filters
          </button>
        </p>
      )}
    </section>
  );
}
