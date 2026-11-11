import { useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cart, formatPrice, getProductPrice, useCart } from "@/lib/cart";
import { watches } from "@/lib/watches";
import { Button } from "@/components/ui/button";

export function CartDrawer() {
  const { items, open, total, count, hasUnavailablePrice, hasUnavailableProduct } = useCart();
  const navigate = useNavigate();
  const [catalogState, setCatalogState] = useState<"idle" | "loading" | "error">("idle");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const hasItems = items.length > 0;

  useEffect(() => {
    if (!open || !hasItems) {
      setCatalogState("idle");
      return;
    }

    let cancelled = false;
    setCatalogState("loading");
    void import("@/lib/products")
      .then(({ ensureProducts }) => ensureProducts(catalogRetry > 0))
      .then((loaded) => {
        if (!cancelled) setCatalogState(loaded ? "idle" : "error");
      })
      .catch((error: unknown) => {
        console.error("[Products] Could not load cart items", error);
        if (!cancelled) setCatalogState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [catalogRetry, hasItems, open]);

  return (
    <>
      <Sheet open={open} onOpenChange={cart.setOpen}>
        <SheetContent className="cart-sheet">
          <SheetHeader>
            <SheetTitle className="cart-title">Your cart</SheetTitle>
            <SheetDescription>Free insured delivery · 7 days replacement</SheetDescription>
          </SheetHeader>
          {catalogState === "loading" ? (
            <p className="cart-empty" role="status">
              Loading your cart…
            </p>
          ) : items.length === 0 ? (
            <p className="cart-empty">Your cart is empty. Add a timepiece from the collection.</p>
          ) : (
            <ul className="cart-list">
              {items.map((item) => {
                const w = watches.find((x) => x.id === item.id);
                if (!w) return null;
                const price = getProductPrice(w.id);
                return (
                  <li key={item.id} className="cart-row">
                    <img src={w.image} alt="" />
                    <div className="cart-row-info">
                      <strong>{w.name}</strong>
                      <small>
                        {w.finish} ·{" "}
                        {price === undefined ? "Price unavailable" : formatPrice(price)}
                      </small>
                      <div className="cart-qty">
                        <button
                          type="button"
                          aria-label="Decrease"
                          onClick={() => cart.setQty(item.id, item.qty - 1)}
                        >
                          <Minus size={13} />
                        </button>
                        <span>{item.qty}</span>
                        <button
                          type="button"
                          aria-label="Increase"
                          onClick={() => cart.setQty(item.id, item.qty + 1)}
                        >
                          <Plus size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove"
                          className="cart-remove"
                          onClick={() => cart.setQty(item.id, 0)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {catalogState === "error" && (
            <p role="alert">
              Product details could not be refreshed. Prices may be out of date.{" "}
              <button type="button" onClick={() => setCatalogRetry((retry) => retry + 1)}>
                Try again
              </button>
            </p>
          )}
          {items.length > 0 && (
            <div className="cart-footer">
              <div className="cart-total">
                <span>
                  Total ({count} item{count > 1 ? "s" : ""})
                </span>
                <b>
                  {hasUnavailableProduct || hasUnavailablePrice
                    ? "Unavailable"
                    : formatPrice(total)}
                </b>
              </div>
              {(hasUnavailableProduct || hasUnavailablePrice) && (
                <p role="alert">
                  A cart item is unavailable or has no price. Remove it or refresh the collection
                  before checkout.
                </p>
              )}
              <Button
                type="button"
                className="cart-checkout"
                disabled={hasUnavailableProduct || hasUnavailablePrice}
                onClick={() => {
                  cart.setOpen(false);
                  void navigate({ to: "/checkout" });
                }}
              >
                Place order
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
