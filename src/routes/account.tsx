import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Heart,
  MapPin,
  Package,
  PackageCheck,
  Trash2,
  Truck,
  UserRound,
} from "lucide-react";
import { ShopHeader } from "@/components/ShopHeader";
import { AuthLink } from "@/components/AuthLink";
import { useCustomer } from "@/components/CustomerAccounts";
import { cart, getProductPrice } from "@/lib/cart";
import { useWishlist, wishlist } from "@/lib/wishlist";
import { watches } from "@/lib/watches";
import { loadOrders, orderStatus, trackingLink, type Order } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
const usd = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const addBusinessDays = (date: Date, days: number) => {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added += 1;
  }
  return result;
};
const stageCopy = [
  "We have received your order and will prepare it for dispatch.",
  "Your watch is packed and getting ready to leave our facility.",
  "Your order has been handed to the courier and is on its way.",
  "Your order is out for delivery. Please keep your phone available.",
  "Your order has been delivered. We hope you enjoy your BIG-B watch.",
];

export const Route = createFileRoute("/account")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { tab?: "orders"; order?: string } => ({
    ...(search["tab"] === "orders" ? { tab: "orders" as const } : {}),
    ...(typeof search["order"] === "string" ? { order: search["order"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "My Account — BIG-B" },
      { name: "description", content: "Your BIG-B profile, orders and wishlist." },
      { property: "og:title", content: "My Account — BIG-B" },
      { property: "og:description", content: "Your profile, orders and wishlist at BIG-B." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { tab: requestedTab, order: requestedOrder } = Route.useSearch();
  const { user } = useCustomer();
  const [tab, setTab] = useState<"home" | "orders" | "wishlist">(requestedTab ?? "home");
  const [orders, setOrders] = useState<Order[]>([]);
  const [open, setOpen] = useState<string | null>(requestedOrder ?? null);
  const wish = useWishlist();
  useEffect(() => {
    let on = true;
    void loadOrders()
      .then((o) => {
        if (on) setOrders(o);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [user?.id]);
  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
    if (requestedOrder) setOpen(requestedOrder);
  }, [requestedTab, requestedOrder]);
  const name = String(
    user?.user_metadata?.["full_name"] ??
      user?.user_metadata?.["display_name"] ??
      user?.user_metadata?.["name"] ??
      "Guest",
  );
  const back = (
    <button
      type="button"
      className="acc-back"
      onClick={() => {
        setTab("home");
        setOpen(null);
      }}
    >
      <ArrowLeft size={16} /> Account
    </button>
  );

  return (
    <main className="shop-page acc-page">
      <ShopHeader />
      <div className="acc-wrap">
        {tab === "home" && (
          <>
            <section className="acc-card acc-profile">
              <span className="acc-avatar">
                <UserRound size={28} />
              </span>
              <div>
                <p className="acc-hello">Hello, {name.split(" ")[0]}</p>
                <p className="product-muted">{user?.email ?? "Sign in to sync your account"}</p>
              </div>
              <AuthLink profile={!!user} className="acc-edit">
                {user ? "Edit profile" : "Login"}
              </AuthLink>
            </section>
            <div className="acc-quick">
              <button type="button" className="acc-card acc-tile" onClick={() => setTab("orders")}>
                <Package size={22} />
                <span>Orders</span>
                <b>{orders.length}</b>
              </button>
              <button
                type="button"
                className="acc-card acc-tile"
                onClick={() => setTab("wishlist")}
              >
                <Heart size={22} />
                <span>Wishlist</span>
                <b>{wish.length}</b>
              </button>
            </div>
            <section className="acc-card acc-list">
              <button type="button" onClick={() => setTab("orders")}>
                <Package size={18} /> My orders <ChevronRight size={16} />
              </button>
              <button type="button" onClick={() => setTab("wishlist")}>
                <Heart size={18} /> My wishlist <ChevronRight size={16} />
              </button>
              <AuthLink profile={!!user}>
                <UserRound size={18} /> Profile information <ChevronRight size={16} />
              </AuthLink>
              <Link to="/shipping-policy">
                <Package size={18} /> Shipping policy <ChevronRight size={16} />
              </Link>
              <Link to="/returns">
                <Package size={18} /> Returns &amp; refunds <ChevronRight size={16} />
              </Link>
              <Link to="/contact">
                <UserRound size={18} /> Contact us <ChevronRight size={16} />
              </Link>
              {user && (
                <Link to="/seller">
                  <Package size={18} /> Seller dashboard <ChevronRight size={16} />
                </Link>
              )}
            </section>
          </>
        )}

        {tab === "orders" && (
          <>
            {back}
            <h2 className="acc-h">My orders</h2>
            {orders.length === 0 ? (
              <p className="acc-card product-muted">No orders yet.</p>
            ) : (
              orders.map((o) => {
                const ws = o.items
                  .map((l) => ({ ...l, w: watches.find((x) => x.id === l.id)! }))
                  .filter((l) => l.w);
                const placed = new Date(o.placedAt);
                const deliveryFrom = addBusinessDays(placed, 3);
                const deliveryTo = addBusinessDays(placed, 5);
                const { steps, index, cancelled } = orderStatus(o);
                const link = trackingLink(o);
                const delivered = index === steps.length - 1;
                const qty = o.items.reduce((s, l) => s + l.qty, 0);
                const title =
                  ws.length === 1
                    ? ws[0]!.w.name
                    : `${ws[0]?.w.name ?? "Order"} + ${ws.length - 1} more`;
                const expanded = open === o.id;
                return (
                  <article key={o.id} className="acc-card acc-order">
                    <button
                      type="button"
                      className="acc-order-row"
                      aria-expanded={expanded}
                      aria-controls={`tracking-${o.id}`}
                      onClick={() => setOpen(expanded ? null : o.id)}
                    >
                      <span className="acc-order-thumbs">
                        {ws.slice(0, 3).map((l) => (
                          <img key={l.id} src={l.w.image} alt={l.w.name} />
                        ))}
                      </span>
                      <div className="acc-order-summary">
                        <p className="acc-order-name">{title}</p>
                        <p
                          className={
                            cancelled
                              ? "acc-status is-cancelled"
                              : delivered
                                ? "product-delivery-free"
                                : "acc-status"
                          }
                        >
                          {cancelled ? "Cancelled" : delivered ? "Delivered" : steps[index]}
                        </p>
                        <small>Order #{o.id}</small>
                      </div>
                      <ChevronRight className="acc-order-chevron" size={18} />
                    </button>
                    {expanded && (
                      <div id={`tracking-${o.id}`} className="trk-detail">
                        <div className="trk-overview">
                          <div>
                            <span>ORDER STATUS</span>
                            <strong className={cancelled ? "is-cancelled" : ""}>
                              {cancelled ? "Cancelled" : steps[index]}
                            </strong>
                          </div>
                          <div>
                            <span>
                              <CalendarDays size={14} /> ESTIMATED DELIVERY
                            </span>
                            <strong>
                              {cancelled
                                ? "Not available"
                                : delivered
                                  ? "Delivered"
                                  : `${fmt(deliveryFrom)} – ${fmt(deliveryTo)}`}
                            </strong>
                          </div>
                        </div>
                        {!cancelled ? (
                          <section
                            className="trk-panel"
                            aria-label={`Tracking updates for order ${o.id}`}
                          >
                            <h3>Shipment updates</h3>
                            <ol className="trk">
                              {steps.map((stage, i) => {
                                const done = i <= index;
                                const current = i === index;
                                return (
                                  <li
                                    key={stage}
                                    className={`trk-step${done ? " done" : ""}${current ? " current" : ""}`}
                                  >
                                    <span className="trk-dot">
                                      {done ? <CheckCircle2 size={18} /> : i + 1}
                                    </span>
                                    <div className="trk-step-copy">
                                      <strong>{stage}</strong>
                                      <p>
                                        {done
                                          ? stageCopy[i]
                                          : "We will update this step as your order progresses."}
                                      </p>
                                      <small>
                                        {i === 0
                                          ? `Order placed ${fmt(placed)}`
                                          : current
                                            ? "Latest update from BIG-B"
                                            : done
                                              ? "Completed"
                                              : "Pending"}
                                      </small>
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          </section>
                        ) : (
                          <p className="trk-cancel-note">
                            This order has been cancelled. If you need help,{" "}
                            <Link to="/contact">contact BIG-B support</Link>.
                          </p>
                        )}
                        {!cancelled && (
                          <div className="trk-shipment-grid">
                            <section className="trk-shipment-card">
                              <h3>
                                <Truck size={17} /> Courier tracking
                              </h3>
                              <dl>
                                <div>
                                  <dt>Courier partner</dt>
                                  <dd>{o.courier || "Not assigned yet"}</dd>
                                </div>
                                <div>
                                  <dt>Tracking / AWB number</dt>
                                  <dd>{o.awb || "Not added yet"}</dd>
                                </div>
                              </dl>
                              {link ? (
                                <a
                                  className="trk-track-link"
                                  href={link}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Track with courier <ExternalLink size={15} />
                                </a>
                              ) : (
                                <p className="trk-hint">
                                  Courier tracking will be available once your order is dispatched.
                                </p>
                              )}
                            </section>
                            {o.address && (
                              <section className="trk-shipment-card">
                                <h3>
                                  <MapPin size={17} /> Delivery address
                                </h3>
                                <p>
                                  <strong>{o.address.name}</strong>
                                  <br />
                                  {o.address.address}
                                  {o.address.locality ? `, ${o.address.locality}` : ""}
                                  <br />
                                  {o.address.city}, {o.address.state} – {o.address.pincode}
                                  <br />
                                  Mobile: {o.address.mobile}
                                </p>
                              </section>
                            )}
                          </div>
                        )}
                        <div className="acc-lines">
                          {ws.map((l) => (
                            <div key={l.id} className="acc-line">
                              <img src={l.w.image} alt="" />
                              <span>
                                {l.w.name} × {l.qty}
                              </span>
                              <span>{usd(l.price * l.qty)}</span>
                            </div>
                          ))}
                        </div>
                        <dl className="acc-details">
                          <div>
                            <dt>Order ID</dt>
                            <dd>{o.id}</dd>
                          </div>
                          <div>
                            <dt>Ordered on</dt>
                            <dd>{fmt(placed)}</dd>
                          </div>
                          <div>
                            <dt>Items</dt>
                            <dd>{qty}</dd>
                          </div>
                          <div>
                            <dt>Total</dt>
                            <dd>{usd(o.total)}</dd>
                          </div>
                          <div>
                            <dt>Payment</dt>
                            <dd>
                              {o.payment === "cod"
                                ? "Cash on delivery"
                                : o.payment === "upi"
                                  ? "UPI payment verified by store"
                                  : o.payment === "razorpay"
                                    ? "Razorpay payment verified"
                                    : o.payment}
                            </dd>
                          </div>
                          {o.payment === "razorpay" && o.paymentReference && (
                            <div>
                              <dt>Razorpay payment reference</dt>
                              <dd>{o.paymentReference}</dd>
                            </div>
                          )}
                        </dl>
                        <div className="trk-actions">
                          <Link
                            to="/invoice/$orderId"
                            params={{ orderId: o.id }}
                            className="co-change"
                          >
                            <PackageCheck size={15} /> View / print invoice
                          </Link>
                        </div>
                      </div>
                    )}
                    {!cancelled &&
                      index <= 1 &&
                      (o.payment === "razorpay" ? (
                        <p className="trk-hint">
                          For cancellation or refund requests for this Razorpay payment,{" "}
                          <Link to="/contact">contact BIG-B support</Link>.
                        </p>
                      ) : (
                        <button
                          type="button"
                          className="co-change text-destructive"
                          onClick={async () => {
                            if (!confirm("Cancel this order?")) return;
                            try {
                              const { data, error } = await supabase.rpc("cancel_order", {
                                _order_id: o.id,
                              });
                              if (error) throw error;
                              if (!data) {
                                alert("This order can no longer be cancelled.");
                                return;
                              }
                              setOrders((all) =>
                                all.map((x) => (x.id === o.id ? { ...x, status: "cancelled" } : x)),
                              );
                            } catch (error) {
                              console.error("Could not cancel order.", error);
                              alert("Could not cancel this order. Please try again.");
                            }
                          }}
                        >
                          Cancel order
                        </button>
                      ))}
                  </article>
                );
              })
            )}
          </>
        )}

        {tab === "wishlist" && (
          <>
            {back}
            <h2 className="acc-h">My wishlist ({wish.length})</h2>
            {wish.length === 0 ? (
              <p className="acc-card product-muted">
                Your wishlist is empty. Tap the heart on any watch to save it.
              </p>
            ) : (
              wish.map((id) => {
                const w = watches.find((x) => x.id === id);
                if (!w) return null;
                return (
                  <article key={id} className="acc-card acc-order">
                    <div className="acc-order-row">
                      <Link to="/shop/$watchId" params={{ watchId: id }}>
                        <img src={w.image} alt={w.name} />
                      </Link>
                      <div>
                        <p className="acc-order-name">{w.name}</p>
                        <p className="product-price">
                          {getProductPrice(id) === undefined
                            ? "Price unavailable"
                            : usd(getProductPrice(id)!)}
                        </p>
                        <button
                          type="button"
                          className="product-cart acc-move"
                          onClick={() => {
                            cart.add(id);
                            wishlist.remove(id);
                          }}
                        >
                          Move to cart
                        </button>
                      </div>
                      <button type="button" aria-label="Remove" onClick={() => wishlist.remove(id)}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </>
        )}
      </div>
    </main>
  );
}
