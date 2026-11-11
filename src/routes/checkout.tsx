import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  LocateFixed,
  MapPin,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Truck,
} from "lucide-react";
import { whatsappLink } from "@/lib/whatsapp";
import { toast } from "sonner";
import { ShopHeader } from "@/components/ShopHeader";
import { AuthLink } from "@/components/AuthLink";
import { cart, getProductPrice, useCart } from "@/lib/cart";
import {
  checkRazorpayPaymentStatus,
  createCodOrder,
  createRazorpayPaymentOrder,
  resumeRazorpayPaymentOrder,
  verifyRazorpayPayment,
} from "@/lib/payments.functions";
import { watches, type WatchTone } from "@/lib/watches";
import { ensureProducts } from "@/lib/products";
import { useCustomer } from "@/components/CustomerAccounts";
import { useStock } from "@/lib/inventory";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  formatStreetAddress,
  getAddressCity,
  getAddressLocality,
  type ReverseGeocodedAddress,
} from "@/lib/reverse-geocode";

type Address = {
  name: string;
  mobile: string;
  pincode: string;
  locality: string;
  address: string;
  city: string;
  state: string;
  landmark: string;
  type: "Home" | "Work";
};
const EMPTY: Address = {
  name: "",
  mobile: "",
  pincode: "",
  locality: "",
  address: "",
  city: "",
  state: "",
  landmark: "",
  type: "Home",
};
const KEY = "private-flight-address";
const usd = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const razorpayPendingKey = (userId: string) => `razorpay-pending-order:${userId}`;
const razorpayDismissedPendingKey = (userId: string) =>
  `razorpay-dismissed-pending-order:${userId}`;
type PendingRazorpayOrder = Extract<
  Awaited<ReturnType<typeof createRazorpayPaymentOrder>>,
  { status: "pending" }
>;
type RazorpayCheckoutOrder = PendingRazorpayOrder;
type CheckoutPaymentMethod = "cod" | "razorpay";
type CheckoutLine = { id: string; qty: number };

function checkoutItemsKey(items: CheckoutLine[]) {
  return [...items]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, qty }) => `${id}:${qty}`)
    .join("|");
}

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string; email?: string };
  notes: { bigb_order_id: string };
  config: {
    display: {
      hide: { method: "upi"; flows: ["collect"] }[];
    };
  };
  theme: { color: string };
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
  modal: { ondismiss: () => void };
};

type RazorpayCheckoutInstance = {
  open: () => void;
  on: (event: "payment.failed", callback: () => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpaySdk(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    const scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => {
        if (window.Razorpay) resolve();
        else reject(new Error("Razorpay checkout did not initialize. Please reload."));
      };
      script.onerror = () =>
        reject(new Error("Could not load Razorpay checkout. Check your connection."));
      document.head.appendChild(script);
    });
    razorpayScriptPromise = scriptPromise.catch((error: unknown) => {
      razorpayScriptPromise = null;
      throw error;
    });
  }
  const pendingScript = razorpayScriptPromise;
  if (!pendingScript) throw new Error("Could not start Razorpay checkout. Please reload.");
  return pendingScript;
}

type NotificationChannels = {
  email: "sent" | "failed" | "not_configured";
};

function notificationOutcome(label: string, result: NotificationChannels): string {
  if (result.email === "sent") return `${label}: email sent`;
  if (result.email === "not_configured") return `${label}: email not configured`;
  return `${label}: email could not be sent`;
}

function showOrderNotificationOutcome(
  customer: NotificationChannels | undefined,
  owner: NotificationChannels | undefined,
) {
  if (!customer || !owner) {
    toast.success("Payment received and order confirmed.");
    return;
  }
  if (customer.email === "sent" && owner.email === "sent") {
    toast.success("Order placed! Email alerts sent to you and the store.", {
      icon: <CheckCircle2 />,
    });
    return;
  }
  const detail = [notificationOutcome("Customer", customer), notificationOutcome("Store", owner)]
    .filter(Boolean)
    .join(". ");
  const hasMissingConfiguration = [customer.email, owner.email].includes("not_configured");
  const setupHint = hasMissingConfiguration
    ? " Add the Resend server settings to enable email notifications."
    : "";
  toast.warning(`Order is saved. ${detail}.${setupHint}`, { duration: 10000 });
}

export const Route = createFileRoute("/checkout")({
  ssr: false,
  beforeLoad: async () => {
    await ensureProducts();
  },
  validateSearch: (s: Record<string, unknown>): { item?: WatchTone } =>
    watches.some((w) => w.id === s["item"]) ? { item: s["item"] as WatchTone } : {},
  head: () => ({
    meta: [
      { title: "Checkout — BIG-B" },
      {
        name: "description",
        content: "Add your delivery address and place your order with BIG-B.",
      },
      { property: "og:title", content: "Checkout — BIG-B" },
      {
        property: "og:description",
        content: "Add your delivery address and place your order with BIG-B.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Checkout,
});

function Checkout() {
  const { item } = Route.useSearch();
  const fromCart = !item;
  const c = useCart();
  const [single, setSingle] = useState(1);
  const lines: { id: string; qty: number }[] = fromCart ? c.items : [{ id: item, qty: single }];
  const setQty = (id: string, q: number) => {
    if (fromCart) cart.setQty(id, q);
    else setSingle(Math.max(1, q));
  };
  const [a, setA] = useState<Address>(EMPTY);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [placed, setPlaced] = useState<{
    id: string;
    total: number;
    count: number;
    payment: "cod" | "razorpay";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>("cod");
  const [paymentAttempt, setPaymentAttempt] = useState<{
    orderId: string;
    total: number;
    count: number;
    items: CheckoutLine[];
    paymentMethod: "razorpay";
    status: "pending" | "failed" | "paid_review";
  } | null>(null);
  const [dismissedPendingOrderId, setDismissedPendingOrderId] = useState<string | null>(null);
  const paymentBusyRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const { user, ready } = useCustomer();
  const stock = useStock();
  const [codOk, setCodOk] = useState(false);
  const activeItemsKey = checkoutItemsKey(lines);
  const activePaymentAttempt =
    paymentAttempt && checkoutItemsKey(paymentAttempt.items) === activeItemsKey
      ? paymentAttempt
      : null;
  const short = stock ? lines.filter((l) => (stock[l.id] ?? 0) < l.qty) : [];
  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY);
      if (r) setA(JSON.parse(r) as Address);
    } catch {
      /* ignore */
    }
  }, []);
  const set =
    (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setA({ ...a, [k]: e.target.value });
  const fillFromCurrentLocation = async () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available in this browser");
      return;
    }
    setLocationBusy(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 30000,
        });
      });
      const params = new URLSearchParams({
        format: "jsonv2",
        lat: String(position.coords.latitude),
        lon: String(position.coords.longitude),
        addressdetails: "1",
        "accept-language": "en",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
      if (!response.ok) throw new Error("Could not look up an address for this location");
      const result = (await response.json()) as {
        display_name?: string;
        address?: ReverseGeocodedAddress;
      };
      const address = result.address;
      if (!address) throw new Error("No address was found for this location");
      const street = formatStreetAddress(address) || result.display_name || "";
      const locality = getAddressLocality(address);
      const city = getAddressCity(address);
      setA((current) => ({
        ...current,
        address: street || current.address,
        locality: locality || current.locality,
        city: city || current.city,
        state: address.state || current.state,
        pincode: address.postcode || current.pincode,
      }));
      setLocationAccuracy(position.coords.accuracy);
      toast.success(
        "Nearby address details added. Check the house/building and street before saving.",
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number"
      ) {
        const message =
          error.code === 1
            ? "Allow location access in your browser to use this option"
            : error.code === 3
              ? "Location request timed out. Please try again"
              : "Could not get your location. Please try again";
        toast.error(message);
      } else {
        toast.error(
          error instanceof Error ? error.message : "Could not find an address for your location",
        );
      }
    } finally {
      setLocationBusy(false);
    }
  };
  const saveAddress = () => {
    if (
      !a.name.trim() ||
      !/^[6-9]\d{9}$/.test(a.mobile) ||
      !/^\d{6}$/.test(a.pincode) ||
      !a.address.trim() ||
      !a.city.trim() ||
      !a.state.trim()
    ) {
      toast.error("Fill name, 10-digit mobile, 6-digit pincode, address, city and state");
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(a));
    setStep(2);
  };

  const count = lines.reduce((s, l) => s + l.qty, 0);
  const hasUnavailableProduct = lines.some(
    (line) => !watches.some((watch) => watch.id === line.id),
  );
  const hasUnavailablePrice = lines.some((line) => getProductPrice(line.id) === undefined);
  const total = lines.reduce((sum, line) => {
    const price = getProductPrice(line.id);
    return sum + line.qty * (price ?? 0);
  }, 0);
  const totalLabel = hasUnavailableProduct || hasUnavailablePrice ? "Unavailable" : usd(total);
  const applyRazorpayPaymentStatus = useCallback(
    (
      result: {
        orderId: string;
        total: number;
        count: number;
        clearCart: boolean;
        paymentMethod: "razorpay";
        status: string;
      },
      showPendingMessage = true,
    ) => {
      if (result.status === "paid") {
        if (result.clearCart) cart.clear();
        try {
          if (user) {
            if (localStorage.getItem(razorpayPendingKey(user.id)) === result.orderId) {
              localStorage.removeItem(razorpayPendingKey(user.id));
            }
            if (localStorage.getItem(razorpayDismissedPendingKey(user.id)) === result.orderId) {
              localStorage.removeItem(razorpayDismissedPendingKey(user.id));
            }
          }
        } catch (error) {
          console.error("[Razorpay] Could not clear local payment recovery ID", error);
        }
        setPaymentAttempt(null);
        setDismissedPendingOrderId(null);
        setPlaced({
          id: result.orderId,
          total: result.total,
          count: result.count,
          payment: "razorpay",
        });
        idempotencyKeyRef.current = null;
        toast.success("Payment verified and order confirmed.");
      } else if (result.status === "failed") {
        let isDismissed = false;
        try {
          if (user) {
            isDismissed =
              localStorage.getItem(razorpayDismissedPendingKey(user.id)) === result.orderId;
            if (localStorage.getItem(razorpayPendingKey(user.id)) === result.orderId) {
              localStorage.removeItem(razorpayPendingKey(user.id));
            }
            if (isDismissed) {
              localStorage.removeItem(razorpayDismissedPendingKey(user.id));
            }
          }
        } catch (error) {
          console.error("[Razorpay] Could not clear local payment recovery ID", error);
        }
        if (isDismissed) {
          setPaymentAttempt(null);
          setDismissedPendingOrderId(null);
          idempotencyKeyRef.current = null;
          return;
        }
        setPaymentAttempt({
          orderId: result.orderId,
          total: result.total,
          count: result.count,
          items: result.items,
          paymentMethod: result.paymentMethod,
          status: "failed",
        });
        setDismissedPendingOrderId(null);
        idempotencyKeyRef.current = null;
        toast.error("Payment failed. Your cart is unchanged; you can safely retry.");
      } else if (result.status === "paid_review") {
        setPaymentAttempt({
          orderId: result.orderId,
          total: result.total,
          count: result.count,
          items: result.items,
          paymentMethod: result.paymentMethod,
          status: "paid_review",
        });
        toast.warning(
          "Payment was received, but stock needs store review. Do not pay again; contact BIG-B.",
          { duration: 12000 },
        );
      } else {
        let isDismissed = false;
        try {
          isDismissed =
            user !== null &&
            localStorage.getItem(razorpayDismissedPendingKey(user.id)) === result.orderId;
        } catch (error) {
          console.error("[Razorpay] Could not read dismissed pending notice", error);
        }
        setPaymentAttempt({
          orderId: result.orderId,
          total: result.total,
          count: result.count,
          items: result.items,
          paymentMethod: result.paymentMethod,
          status: "pending",
        });
        setDismissedPendingOrderId(isDismissed ? result.orderId : null);
        if (showPendingMessage && !isDismissed) {
          toast.info("Payment is still processing. Check the status before trying again.");
        }
      }
    },
    [user],
  );
  const refreshRazorpayPayment = useCallback(
    async (orderId: string) => {
      setCheckingPayment(true);
      try {
        const result = await checkRazorpayPaymentStatus({ data: { orderId } });
        applyRazorpayPaymentStatus(result);
      } catch (error) {
        console.error("[Razorpay] Could not refresh payment status", error);
        toast.error(error instanceof Error ? error.message : "Could not check payment status.");
      } finally {
        setCheckingPayment(false);
      }
    },
    [applyRazorpayPaymentStatus],
  );
  useEffect(() => {
    if (!user || !ready) return;
    try {
      const orderId = localStorage.getItem(razorpayPendingKey(user.id));
      if (orderId && /^PF[A-F0-9]{20}$/.test(orderId)) {
        void checkRazorpayPaymentStatus({ data: { orderId } })
          .then((result) => {
            if (checkoutItemsKey(result.items) === activeItemsKey) {
              applyRazorpayPaymentStatus(result);
              return;
            }
            if (result.status !== "pending") {
              if (localStorage.getItem(razorpayPendingKey(user.id)) === orderId) {
                localStorage.removeItem(razorpayPendingKey(user.id));
              }
              if (localStorage.getItem(razorpayDismissedPendingKey(user.id)) === orderId) {
                localStorage.removeItem(razorpayDismissedPendingKey(user.id));
              }
            }
          })
          .catch((error: unknown) => {
            console.error("[Razorpay] Could not restore payment status", error);
          });
      }
    } catch (error) {
      console.error("[Razorpay] Could not read local payment recovery ID", error);
    }
  }, [activeItemsKey, applyRazorpayPaymentStatus, ready, user]);

  const launchRazorpayCheckout = async (order: RazorpayCheckoutOrder) => {
    try {
      if (user) localStorage.setItem(razorpayPendingKey(user.id), order.orderId);
    } catch (error) {
      console.error("[Razorpay] Could not store payment recovery ID", error);
    }
    setPaymentAttempt({
      orderId: order.orderId,
      total: order.total,
      count: order.count,
      items: order.items,
      paymentMethod: order.paymentMethod,
      status: "pending",
    });
    await loadRazorpaySdk();
    const Razorpay = window.Razorpay;
    if (!Razorpay) throw new Error("Razorpay checkout did not initialize. Please reload.");

    const releasePaymentLock = () => {
      paymentBusyRef.current = false;
      setBusy(false);
    };
    const refreshCheckoutAfterDismissal = () => {
      try {
        if (user) {
          localStorage.setItem(razorpayDismissedPendingKey(user.id), order.orderId);
        }
      } catch (error) {
        console.error("[Razorpay] Could not save checkout dismissal state", error);
        toast.error("Could not refresh checkout safely. Check your payment status before retrying.");
        releasePaymentLock();
        return;
      }
      releasePaymentLock();
      window.location.reload();
    };
    const checkout = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "BIG-B Watches",
      description: `Order ${order.orderId}`,
      order_id: order.razorpayOrderId,
      prefill: {
        name: order.name,
        contact: order.mobile,
        ...(order.email ? { email: order.email } : {}),
      },
      notes: { bigb_order_id: order.orderId },
      config: {
        display: {
          hide: [{ method: "upi", flows: ["collect"] }],
        },
      },
      theme: { color: "#111827" },
      handler: async (response) => {
        try {
          const result = await verifyRazorpayPayment({
            data: {
              orderId: order.orderId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
          });
          applyRazorpayPaymentStatus(result);
        } catch (error) {
          console.error("[Razorpay] Could not verify checkout response", error);
          toast.error(
            "Payment verification is taking longer than expected. Check payment status before retrying.",
          );
        } finally {
          releasePaymentLock();
        }
      },
      modal: { ondismiss: refreshCheckoutAfterDismissal },
    });
    checkout.on("payment.failed", refreshCheckoutAfterDismissal);
    checkout.open();
  };

  const startRazorpayCheckout = async () => {
    if (paymentBusyRef.current) return;
    paymentBusyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      const order = await createRazorpayPaymentOrder({
        data: {
          items: lines.map(({ id, qty }) => ({ id, qty })),
          address: a,
          idempotencyKey,
          clearCart: fromCart,
        },
      });
      if (order.status !== "pending") {
        applyRazorpayPaymentStatus(order);
        paymentBusyRef.current = false;
        setBusy(false);
        return;
      }
      await launchRazorpayCheckout(order);
    } catch (error) {
      idempotencyKeyRef.current = null;
      paymentBusyRef.current = false;
      setBusy(false);
      throw error;
    }
  };

  const resumePendingRazorpayCheckout = async (orderId: string) => {
    if (paymentBusyRef.current) return;
    paymentBusyRef.current = true;
    setBusy(true);
    try {
      const order = await resumeRazorpayPaymentOrder({ data: { orderId } });
      if (order.status !== "pending") {
        applyRazorpayPaymentStatus(order);
        paymentBusyRef.current = false;
        setBusy(false);
        return;
      }
      await launchRazorpayCheckout(order);
    } catch (error) {
      paymentBusyRef.current = false;
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not reopen Razorpay Checkout.");
    }
  };

  const placeOrder = async () => {
    if (lines.length === 0) {
      toast.error("Your cart is empty");
      return;
    }
    if (hasUnavailableProduct || hasUnavailablePrice) {
      toast.error(
        "A cart item is unavailable or has no current price. Remove it or refresh the collection before checkout.",
      );
      return;
    }
    if (!user) {
      toast.error("Please sign in to place your order");
      return;
    }
    if (short.length) {
      toast.error("Some watches are out of stock — reduce the quantity");
      return;
    }
    if (activePaymentAttempt?.status === "pending") {
      if (paymentMethod === "razorpay") {
        await resumePendingRazorpayCheckout(activePaymentAttempt.orderId);
        return;
      }
      if (dismissedPendingOrderId !== activePaymentAttempt.orderId) {
        toast.error("A UPI payment is still pending. Check its status before placing a COD order.");
        return;
      }
      if (
        !window.confirm(
          "Razorpay has not confirmed that the UPI payment failed. If you continue with COD and the UPI payment later succeeds, you may be charged for both orders. Continue with COD?",
        )
      ) {
        return;
      }
    }
    if (activePaymentAttempt?.status === "paid_review") {
      toast.error("Your payment is under store review. Contact BIG-B before paying again.");
      return;
    }
    if (paymentMethod === "cod" && !codOk) {
      toast.error("Please confirm you will answer our confirmation call");
      return;
    }
    if (paymentMethod === "razorpay") {
      try {
        await startRazorpayCheckout();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not start Razorpay checkout.");
      }
      return;
    }
    if (paymentBusyRef.current) return;
    paymentBusyRef.current = true;
    setBusy(true);
    try {
      const order = await createCodOrder({
        data: { items: lines.map(({ id, qty }) => ({ id, qty })), address: a },
      });
      if (fromCart) cart.clear();
      setPlaced({ id: order.orderId, total: order.total, count, payment: "cod" });
      showOrderNotificationOutcome(order.notifications, order.ownerNotifications);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not place order");
    } finally {
      paymentBusyRef.current = false;
      setBusy(false);
    }
  };

  if (!placed && !activePaymentAttempt && lines.length === 0)
    return (
      <main className="shop-page co-checkout-page">
        <ShopHeader />
        <div className="co-grid">
          <section className="co-step">
            <h2>Your cart is empty</h2>
            <p className="product-muted">Add a watch to your cart to check out.</p>
            <Link to="/collection" className="product-buy co-continue">
              Browse watches
            </Link>
          </section>
        </div>
      </main>
    );

  return (
    <main className="shop-page co-checkout-page">
      <ShopHeader />
      <div className="co-grid">
        <div className="co-steps">
          <section className="co-step">
            <h2>
              <span>1</span> Delivery address
            </h2>
            {step === 1 ? (
              <div className="co-form">
                <button
                  type="button"
                  className="product-buy co-wide"
                  onClick={() => void fillFromCurrentLocation()}
                  disabled={locationBusy}
                >
                  <LocateFixed size={16} />{" "}
                  {locationBusy ? "Finding your location…" : "Use my current location"}
                </button>
                <p className="co-location-note co-wide">
                  Location fills the address details available on the map
                  {locationAccuracy !== null
                    ? ` (GPS accuracy about ±${Math.round(locationAccuracy)} m)`
                    : ""}
                  . Map data may not include your exact house or apartment, so review and complete
                  the address before continuing.
                </p>
                <input
                  className="shop-input"
                  placeholder="Full name"
                  value={a.name}
                  onChange={set("name")}
                />
                <input
                  className="shop-input"
                  placeholder="10-digit mobile number"
                  inputMode="numeric"
                  maxLength={10}
                  value={a.mobile}
                  onChange={(e) => setA({ ...a, mobile: e.target.value.replace(/\D/g, "") })}
                />
                <input
                  className="shop-input"
                  placeholder="Pincode"
                  inputMode="numeric"
                  maxLength={6}
                  value={a.pincode}
                  onChange={(e) => setA({ ...a, pincode: e.target.value.replace(/\D/g, "") })}
                />
                <input
                  className="shop-input"
                  placeholder="Locality"
                  value={a.locality}
                  onChange={set("locality")}
                />
                <textarea
                  className="shop-input co-wide"
                  rows={3}
                  placeholder="Address (house no, building, street, area)"
                  value={a.address}
                  onChange={set("address")}
                />
                <input
                  className="shop-input"
                  placeholder="City / District / Town"
                  value={a.city}
                  onChange={set("city")}
                />
                <input
                  className="shop-input"
                  placeholder="State"
                  value={a.state}
                  onChange={set("state")}
                />
                <input
                  className="shop-input co-wide"
                  placeholder="Landmark (optional)"
                  value={a.landmark}
                  onChange={set("landmark")}
                />
                <div className="co-type co-wide">
                  Address type
                  {(["Home", "Work"] as const).map((t) => (
                    <label key={t}>
                      <input
                        type="radio"
                        checked={a.type === t}
                        onChange={() => setA({ ...a, type: t })}
                      />{" "}
                      {t}
                    </label>
                  ))}
                </div>
                <button type="button" className="product-buy co-wide" onClick={saveAddress}>
                  Save and deliver here
                </button>
              </div>
            ) : (
              <div className="co-summary-line">
                <MapPin size={16} />
                <p>
                  <b>{a.name}</b> <span className="co-tag">{a.type}</span> {a.mobile}
                  <br />
                  {a.address}, {a.locality && `${a.locality}, `}
                  {a.city}, {a.state} — <b>{a.pincode}</b>
                </p>
                {!placed && (
                  <button type="button" className="co-change" onClick={() => setStep(1)}>
                    Change
                  </button>
                )}
              </div>
            )}
          </section>
          <section className="co-step">
            <h2>
              <span>2</span> Order summary
            </h2>
            {step >= 2 && !placed && (
              <div className="co-items">
                {lines.map((l) => {
                  const w = watches.find((x) => x.id === l.id);
                  const price = getProductPrice(l.id);
                  return (
                    <div key={l.id} className="co-item">
                      {w && <img src={w.image} alt={w.name} />}
                      <div>
                        <p className="product-title co-item-name">{w?.name ?? l.id}</p>
                        {w && <p className="product-muted">{w.finish}</p>}
                        <p className="product-price">
                          {price === undefined ? "Price unavailable" : usd(price)}
                        </p>
                        <div className="co-qty">
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            onClick={() => setQty(l.id, fromCart ? l.qty - 1 : l.qty - 1)}
                          >
                            −
                          </button>
                          <span>{l.qty}</span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            onClick={() => setQty(l.id, l.qty + 1)}
                          >
                            +
                          </button>
                          {fromCart && (
                            <button
                              type="button"
                              aria-label={`Remove ${w?.name ?? l.id}`}
                              onClick={() => cart.setQty(l.id, 0)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      {stock && (stock[l.id] ?? 0) < l.qty && (
                        <p className="product-pin-msg is-err">
                          {(stock[l.id] ?? 0) <= 0 ? "Out of stock" : `Only ${stock[l.id]} left`}
                        </p>
                      )}
                      <span className="co-item-sub">
                        {price === undefined ? "Unavailable" : usd(price * l.qty)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="co-step">
            <h2>
              <span>3</span> Payment
            </h2>
            {step >= 2 && !placed && (
              <div className="co-pay">
                <label>
                  <input
                    type="radio"
                    name="payment-method"
                    checked={paymentMethod === "cod"}
                    onChange={() => setPaymentMethod("cod")}
                  />{" "}
                  Cash on delivery — pay when your watch arrives
                </label>
                <label>
                  <input
                    type="radio"
                    name="payment-method"
                    checked={paymentMethod === "razorpay"}
                    onChange={() => setPaymentMethod("razorpay")}
                  />{" "}
                  Pay with UPI via Razorpay
                </label>
                {paymentMethod === "razorpay" ? (
                  <p className="text-sm text-muted-foreground" role="note">
                    Use a UPI app on mobile or scan the UPI QR code on desktop. Entering a UPI ID
                    is unavailable under current UPI rules. Available options depend on your device
                    and Razorpay account. Your order is confirmed only after payment verification.
                  </p>
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      checked={codOk}
                      onChange={(e) => setCodOk(e.target.checked)}
                    />{" "}
                    I will answer a confirmation call on {a.mobile} before dispatch
                  </label>
                )}
                {activePaymentAttempt &&
                  !(
                    activePaymentAttempt.status === "pending" &&
                    dismissedPendingOrderId === activePaymentAttempt.orderId
                  ) && (
                  <div className="space-y-2" role="status">
                    <p>
                      Razorpay payment for order <b>{activePaymentAttempt.orderId}</b>:{" "}
                      <b>
                        {activePaymentAttempt.status === "paid_review"
                          ? "Paid — store review needed"
                          : activePaymentAttempt.status.charAt(0).toUpperCase() +
                            activePaymentAttempt.status.slice(1)}
                      </b>
                    </p>
                    {activePaymentAttempt.status === "pending" && (
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="co-change"
                          onClick={() => void refreshRazorpayPayment(activePaymentAttempt.orderId)}
                          disabled={checkingPayment}
                        >
                          {checkingPayment ? "Checking…" : "Check payment status"}
                        </button>
                        <button
                          type="button"
                          className="co-change"
                          onClick={() => void resumePendingRazorpayCheckout(activePaymentAttempt.orderId)}
                          disabled={busy || checkingPayment}
                        >
                          {busy ? "Opening…" : "Continue payment"}
                        </button>
                        <button
                          type="button"
                          className="co-change"
                          onClick={() => {
                            if (!user) return;
                            try {
                              localStorage.setItem(
                                razorpayDismissedPendingKey(user.id),
                                activePaymentAttempt.orderId,
                              );
                              setDismissedPendingOrderId(activePaymentAttempt.orderId);
                            } catch (error) {
                              console.error("[Razorpay] Could not hide pending notice", error);
                              toast.error("Could not hide the pending notice. Please try again.");
                            }
                          }}
                        >
                          Hide pending notice
                        </button>
                      </div>
                    )}
                    {activePaymentAttempt.status === "failed" && (
                      <p className="text-sm text-muted-foreground">
                        Your cart is unchanged. Choose a payment method and retry safely.
                      </p>
                    )}
                    {activePaymentAttempt.status === "paid_review" && (
                      <p className="text-sm text-muted-foreground">
                        Do not pay again. Contact BIG-B support to complete your order.
                      </p>
                    )}
                  </div>
                )}
                {activePaymentAttempt?.status === "pending" &&
                  paymentMethod === "cod" &&
                  (
                  <p className="text-sm text-muted-foreground" role="alert">
                    {dismissedPendingOrderId === activePaymentAttempt.orderId
                      ? "Razorpay has not confirmed that the UPI payment failed. You can continue with COD, but the UPI payment could still complete and charge you."
                      : "A UPI payment is still pending. Check its status before placing a COD order to avoid duplicate orders."}
                  </p>
                )}
                {ready && !user && (
                  <p className="product-pin-msg is-err">
                    Please <AuthLink>sign in</AuthLink> to place your order so you can track it.
                  </p>
                )}
              </div>
            )}
            {placed && (
              <div className="co-pay">
                <p>
                  <CheckCircle2 size={18} className="product-delivery-free" />{" "}
                  <b>Order confirmed!</b>
                </p>
                <p>
                  Order ID: <b>{placed.id}</b>
                </p>
                {placed.payment === "cod" && (
                  <p>
                    Pay <b>{usd(placed.total)}</b> in cash when your{" "}
                    {placed.count > 1 ? `${placed.count} watches arrive` : "watch arrives"} in{" "}
                    {a.city}. We will call {a.mobile} to confirm before dispatch. Estimated
                    delivery: 3–5 business days.
                  </p>
                )}
                {placed.payment === "razorpay" && (
                  <p>
                    Your Razorpay payment has been verified. The order is confirmed and the payment
                    reference is available on your invoice.
                  </p>
                )}
                <Link to="/invoice/$orderId" params={{ orderId: placed.id }} className="co-change">
                  View / print invoice
                </Link>
                <Link
                  to="/account"
                  search={{ tab: "orders", order: placed.id }}
                  className="product-buy co-continue"
                >
                  Track my order
                </Link>
                <Link to="/collection" className="co-change">
                  Continue shopping
                </Link>
              </div>
            )}
          </section>
        </div>
        {!placed && (
          <aside className="co-price">
            <h3>Price details</h3>
            {lines.map((l) => {
              const w = watches.find((x) => x.id === l.id);
              const price = getProductPrice(l.id);
              return (
                <div key={l.id}>
                  <span>
                    {w?.name ?? l.id} × {l.qty}
                  </span>
                  <span>{price === undefined ? "Unavailable" : usd(price * l.qty)}</span>
                </div>
              );
            })}
            <div>
              <span>
                Price ({count} item{count > 1 ? "s" : ""})
              </span>
              <span>{totalLabel}</span>
            </div>
            <div>
              <span>Delivery charges</span>
              <span className="product-delivery-free">Free</span>
            </div>
            <div className="co-total">
              <span>Total amount</span>
              <span>{totalLabel}</span>
            </div>
            {step === 2 && (
              <button
                type="button"
                className="product-buy co-price-continue"
                onClick={() => setStep(3)}
              >
                Continue
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                className="product-buy co-price-continue"
                disabled={
                  busy ||
                  checkingPayment ||
                  !user ||
                  hasUnavailableProduct ||
                  hasUnavailablePrice ||
                  short.length > 0 ||
                  (paymentMethod === "cod" && !codOk) ||
                  (paymentMethod === "cod" &&
                    activePaymentAttempt?.status === "pending" &&
                    dismissedPendingOrderId !== activePaymentAttempt.orderId) ||
                  activePaymentAttempt?.status === "paid_review"
                }
                onClick={() => void placeOrder()}
              >
                {busy
                  ? "Please wait…"
                  : activePaymentAttempt?.status === "pending"
                    ? paymentMethod === "razorpay"
                      ? `Continue UPI payment · ${totalLabel}`
                      : dismissedPendingOrderId === activePaymentAttempt.orderId
                        ? `Place COD order · ${totalLabel}`
                        : `COD unavailable · ${totalLabel}`
                    : paymentMethod === "razorpay"
                      ? `Pay with UPI · ${totalLabel}`
                      : `Place COD order · ${totalLabel}`}
              </button>
            )}
            <ul className="co-badges">
              <li>
                <BadgeCheck size={16} /> 100% Original
              </li>
              <li>
                <ShieldCheck size={16} /> 2-Year Warranty
              </li>
              <li>
                <RotateCcw size={16} /> 7-Day Easy Returns
              </li>
              <li>
                <Truck size={16} /> Free Insured Shipping
              </li>
            </ul>
            <a
              className="product-wa"
              href={whatsappLink(
                `Hi! I'd like help ordering: ${lines.map((l) => `${watches.find((x) => x.id === l.id)?.name ?? l.id} × ${l.qty}`).join(", ")} (total ${usd(total)}).`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={16} /> Need help? Order on WhatsApp
            </a>
            {item ? (
              <Link to="/shop/$watchId" params={{ watchId: item }} className="co-change">
                ← Back to product
              </Link>
            ) : (
              <Link to="/collection" className="co-change">
                ← Keep shopping
              </Link>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
