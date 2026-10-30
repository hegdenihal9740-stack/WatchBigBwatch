import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadOrders, fromRow, type Order, type OrderRow } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { watches } from "@/lib/watches";
import { STORE_CONTACT } from "@/lib/store-info";
import bigBLogoLight from "@/assets/big-b-logo-light.png";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export const Route = createFileRoute("/invoice/$orderId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Invoice — BIG-B" },
      {
        name: "description",
        content: "Printable BIG-B invoice and shipping label for your order.",
      },
      { property: "og:title", content: "Invoice — BIG-B" },
      { property: "og:description", content: "Printable BIG-B invoice and shipping label." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Invoice,
});

function Invoice() {
  const { orderId } = Route.useParams();
  const [o, setO] = useState<Order | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
      if (data) {
        setO(fromRow(data as OrderRow));
        return;
      }
      setO((await loadOrders()).find((x) => x.id === orderId) ?? null);
    })();
  }, [orderId]);
  if (o === undefined)
    return (
      <main className="inv">
        <p>Loading…</p>
      </main>
    );
  if (!o)
    return (
      <main className="inv">
        <p>
          Order not found. <Link to="/account">My orders</Link>
        </p>
      </main>
    );
  const a = o.address;
  return (
    <main className="inv">
      <div className="inv-actions">
        <button type="button" className="product-buy" onClick={() => window.print()}>
          Print
        </button>
        <Link to="/account" className="co-change">
          Back
        </Link>
      </div>
      <header className="inv-head">
        <div className="inv-brand">
          <img src={bigBLogoLight} alt="" />
          <div>
            <h1>{STORE_CONTACT.name}</h1>
            <p>
              {STORE_CONTACT.address}
              <br />
              {STORE_CONTACT.phone} · {STORE_CONTACT.email}
            </p>
          </div>
        </div>
        <div>
          <h2>Tax invoice</h2>
          <p>
            Order <b>{o.id}</b>
            <br />
            {new Date(o.placedAt).toLocaleDateString("en-IN")}
            <br />
            {o.payment === "cod"
              ? "Cash on delivery"
              : o.payment === "upi"
                ? "UPI payment verified by store"
                : o.payment === "razorpay"
                  ? "Razorpay payment verified"
                  : "Paid online"}
            {o.payment === "razorpay" && o.paymentReference && (
              <>
                <br />
                Razorpay reference <b>{o.paymentReference}</b>
              </>
            )}
          </p>
        </div>
      </header>
      <section className="inv-ship">
        <h3>Ship to</h3>
        <p>
          <b>{a.name}</b>
          <br />
          {a.address}
          {a.locality ? `, ${a.locality}` : ""}
          <br />
          {a.city}, {a.state} — <b>{a.pincode}</b>
          <br />
          Mobile: {a.mobile}
        </p>
        {o.awb && (
          <p>
            Courier: {o.courier} · AWB {o.awb}
          </p>
        )}
      </section>
      <table className="inv-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((l) => (
            <tr key={l.id}>
              <td>{watches.find((w) => w.id === l.id)?.name ?? l.id}</td>
              <td>{l.qty}</td>
              <td>{inr(l.price)}</td>
              <td>{inr(l.price * l.qty)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Delivery</td>
            <td>Free</td>
          </tr>
          <tr>
            <td colSpan={3}>
              <b>
                Total{" "}
                {o.payment === "cod"
                  ? "(collect in cash)"
                  : o.payment === "upi" || o.payment === "razorpay"
                    ? "(paid)"
                    : ""}
              </b>
            </td>
            <td>
              <b>{inr(o.total)}</b>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="inv-note">Prices include all taxes. 7-day replacement · 2-year warranty.</p>
    </main>
  );
}
