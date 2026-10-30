import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { getPaymentTotal, type PaymentLine } from "@/lib/payment";
import { watchPrices } from "@/lib/watches";
import { sendOrderNotifications, sendOwnerOrderNotifications } from "@/lib/notifications.server";
import { STORE_CONTACT } from "@/lib/store-info";

export type PaymentAddress = {
  name: string;
  mobile: string;
  address: string;
  locality?: string | undefined;
  city: string;
  state: string;
  pincode: string;
  landmark?: string | undefined;
  type?: string | undefined;
};

export async function priceOrderLines(
  lines: PaymentLine[],
  client: SupabaseClient<Database> = supabaseAdmin,
) {
  const productIds = [...new Set(lines.map((line) => line.id))];
  const productPrices: Record<string, number> = {};
  if (productIds.length) {
    const { data, error } = await client
      .from("products")
      .select("id,price,active")
      .in("id", productIds);
    if (error) {
      console.error("[Orders] Could not validate products", error);
      throw new Error("Could not validate your cart. Please try again.");
    }
    for (const product of data ?? []) {
      if (!product.active)
        throw new Error("Your cart contains an item that is no longer available.");
      productPrices[product.id] = product.price;
    }
  }

  const total = getPaymentTotal(lines, productPrices);
  return {
    total,
    items: lines.map((line) => {
      const price =
        productPrices[line.id] ??
        (Object.hasOwn(watchPrices, line.id)
          ? watchPrices[line.id as keyof typeof watchPrices]
          : undefined);
      if (price === undefined) throw new Error("Your cart contains an invalid item or quantity");
      return { ...line, price };
    }),
  };
}

export function validateAddress(address: PaymentAddress): PaymentAddress {
  if (
    !address ||
    typeof address.name !== "string" ||
    !address.name.trim() ||
    typeof address.mobile !== "string" ||
    !/^[6-9]\d{9}$/.test(address.mobile) ||
    typeof address.address !== "string" ||
    !address.address.trim() ||
    typeof address.city !== "string" ||
    !address.city.trim() ||
    typeof address.state !== "string" ||
    !address.state.trim() ||
    typeof address.pincode !== "string" ||
    !/^\d{6}$/.test(address.pincode)
  ) {
    throw new Error("Please provide a valid delivery address before paying");
  }
  return address;
}

export async function createCodOrder(
  userId: string,
  lines: PaymentLine[],
  rawAddress: PaymentAddress,
  userClient: SupabaseClient<Database>,
  email: string | null,
) {
  const { total, items } = await priceOrderLines(lines);
  const address = validateAddress(rawAddress);
  const id = `PF${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const { error } = await userClient.from("orders").insert({
    id,
    user_id: userId,
    items,
    total,
    payment: "cod",
    address,
  });
  if (error) {
    console.error("[Orders] Could not create COD order", { orderId: id, error });
    throw new Error(
      error.message.includes("OUT_OF_STOCK")
        ? "Sorry, one of these watches just went out of stock."
        : "Could not place your order. Please try again.",
    );
  }
  const notificationInput = {
    orderId: id,
    email,
    name: address.name,
    mobile: address.mobile,
    total,
    items,
    status: "confirmed",
    payment: "cod",
  };
  const [notifications, ownerNotifications] = await Promise.all([
    sendOrderNotifications(notificationInput),
    sendOwnerOrderNotifications(notificationInput, {
      name: STORE_CONTACT.name,
      email: STORE_CONTACT.email,
    }),
  ]);
  return { orderId: id, total, notifications, ownerNotifications };
}
