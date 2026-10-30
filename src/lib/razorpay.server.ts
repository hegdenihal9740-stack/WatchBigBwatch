import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendOrderNotifications, sendOwnerOrderNotifications } from "@/lib/notifications.server";
import { priceOrderLines, validateAddress, type PaymentAddress } from "@/lib/payment.server";
import type { PaymentLine } from "@/lib/payment";
import { STORE_CONTACT } from "@/lib/store-info";
import {
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "@/lib/razorpay-signature";
import {
  validateRazorpayOrderPayment,
  validateRazorpayQrPayment,
  type RazorpayPaymentRecord,
} from "@/lib/razorpay-payment-validation";

type RazorpayStatus = "creating" | "pending" | "paid" | "paid_review" | "failed";
type ProviderStatus = "created" | "authorized" | "captured" | "failed" | "refunded";

type RazorpayAttempt = {
  id: string;
  user_id: string;
  items: unknown;
  total: number;
  address: unknown;
  clear_cart: boolean;
  currency: string;
  payment_method: "razorpay" | "upi" | "qr";
  razorpay_order_id: string | null;
  razorpay_qr_code_id: string | null;
  payment_id: string | null;
  status: RazorpayStatus;
};

type ProviderPayment = RazorpayPaymentRecord;

type ProviderQrCode = {
  id: string;
  imageUrl: string;
  paymentAmount: number;
  status: "active" | "closed";
  closeBy: number;
};

function parseRazorpayAttempt(
  attempt: Omit<RazorpayAttempt, "status"> & { status: string },
): RazorpayAttempt {
  const { status } = attempt;
  if (
    attempt.payment_method !== "razorpay" &&
    attempt.payment_method !== "upi" &&
    attempt.payment_method !== "qr"
  ) {
    throw new Error("The database returned an unsupported Razorpay payment method.");
  }
  if (
    status !== "creating" &&
    status !== "pending" &&
    status !== "paid" &&
    status !== "paid_review" &&
    status !== "failed"
  ) {
    throw new Error("The database returned an unsupported Razorpay payment status.");
  }
  return { ...attempt, status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}

function expectInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(message);
  return value;
}

function razorpayConfig() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"];
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }
  return { keyId, keySecret, webhookSecret };
}

async function razorpayRequest(path: string, init?: RequestInit): Promise<unknown> {
  const { keyId, keySecret } = razorpayConfig();
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`);
  headers.set("content-type", "application/json");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Razorpay returned an unreadable response.");
  }
  if (!response.ok) {
    const body = isRecord(payload) && isRecord(payload["error"]) ? payload["error"] : {};
    console.error("[Razorpay] Provider request failed", {
      status: response.status,
      code: typeof body["code"] === "string" ? body["code"] : "unknown",
    });
    throw new Error("Razorpay could not process the payment request. Please try again.");
  }
  return payload;
}

function parseProviderPayment(value: unknown): ProviderPayment {
  const payment = expectRecord(value, "Razorpay returned invalid payment details.");
  const status = payment["status"];
  if (
    status !== "created" &&
    status !== "authorized" &&
    status !== "captured" &&
    status !== "failed" &&
    status !== "refunded"
  ) {
    throw new Error("Razorpay returned an unsupported payment status.");
  }
  const orderId = payment["order_id"];
  if (orderId !== null && typeof orderId !== "string") {
    throw new Error("Razorpay returned an invalid order ID.");
  }
  return {
    id: expectString(payment["id"], "Razorpay returned an invalid payment ID."),
    order_id: orderId,
    amount: expectInteger(payment["amount"], "Razorpay returned an invalid payment amount."),
    currency: expectString(payment["currency"], "Razorpay returned an invalid currency."),
    status,
    ...(typeof payment["method"] === "string" ? { method: payment["method"] } : {}),
  };
}

function parseProviderQrCode(value: unknown): ProviderQrCode {
  const qrCode = expectRecord(value, "Razorpay returned invalid QR code details.");
  const imageUrl = expectString(qrCode["image_url"], "Razorpay returned an invalid QR code URL.");
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("Razorpay returned an invalid QR code URL.");
  }
  const status = qrCode["status"];
  if (status !== "active" && status !== "closed") {
    throw new Error("Razorpay returned an unsupported QR code status.");
  }
  if (
    qrCode["type"] !== "upi_qr" ||
    qrCode["usage"] !== "single_use" ||
    qrCode["fixed_amount"] !== true ||
    url.protocol !== "https:" ||
    url.hostname !== "rzp.io"
  ) {
    throw new Error("Razorpay returned an unsupported QR code.");
  }
  return {
    id: expectString(qrCode["id"], "Razorpay returned an invalid QR code ID."),
    imageUrl,
    paymentAmount: expectInteger(
      qrCode["payment_amount"],
      "Razorpay returned an invalid QR code amount.",
    ),
    status,
    closeBy: expectInteger(qrCode["close_by"], "Razorpay returned an invalid QR code expiry."),
  };
}

function parseAttemptItems(value: unknown): { id: string; qty: number; price: number }[] {
  if (!Array.isArray(value)) throw new Error("Payment order contains invalid items.");
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry["id"] !== "string" ||
      typeof entry["qty"] !== "number" ||
      !Number.isInteger(entry["qty"]) ||
      entry["qty"] < 1 ||
      typeof entry["price"] !== "number" ||
      !Number.isSafeInteger(entry["price"]) ||
      entry["price"] < 1
    ) {
      throw new Error("Payment order contains invalid items.");
    }
    return { id: entry["id"], qty: entry["qty"], price: entry["price"] };
  });
}

function paymentResult(attempt: RazorpayAttempt) {
  const items = parseAttemptItems(attempt.items);
  return {
    orderId: attempt.id,
    total: attempt.total,
    count: items.reduce((sum, item) => sum + item.qty, 0),
    items,
    clearCart: attempt.clear_cart,
    paymentMethod: attempt.payment_method,
    status: attempt.status,
  };
}

async function getAttemptById(orderId: string, userId?: string): Promise<RazorpayAttempt> {
  let query = supabaseAdmin
    .from("razorpay_payment_orders")
    .select(
      "id,user_id,items,total,address,clear_cart,currency,payment_method,razorpay_order_id,razorpay_qr_code_id,payment_id,status",
    )
    .eq("id", orderId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    console.error("[Razorpay] Could not load payment order", { orderId, error });
    throw new Error("Could not find this Razorpay payment order.");
  }
  return parseRazorpayAttempt(data);
}

async function getAttemptByProviderId(providerOrderId: string): Promise<RazorpayAttempt | null> {
  const { data, error } = await supabaseAdmin
    .from("razorpay_payment_orders")
    .select(
      "id,user_id,items,total,address,clear_cart,currency,payment_method,razorpay_order_id,razorpay_qr_code_id,payment_id,status",
    )
    .eq("razorpay_order_id", providerOrderId)
    .maybeSingle();
  if (error) {
    console.error("[Razorpay] Could not match provider order", { providerOrderId, error });
    throw new Error("Could not match this Razorpay payment to a store order.");
  }
  return data ? parseRazorpayAttempt(data) : null;
}

async function getAttemptByQrCodeId(qrCodeId: string): Promise<RazorpayAttempt | null> {
  const { data, error } = await supabaseAdmin
    .from("razorpay_payment_orders")
    .select(
      "id,user_id,items,total,address,clear_cart,currency,payment_method,razorpay_order_id,razorpay_qr_code_id,payment_id,status",
    )
    .eq("razorpay_qr_code_id", qrCodeId)
    .maybeSingle();
  if (error) {
    console.error("[Razorpay] Could not match QR code", { qrCodeId, error });
    throw new Error("Could not match this Razorpay QR code to a store order.");
  }
  return data ? parseRazorpayAttempt(data) : null;
}

function sameLines(stored: unknown, submitted: PaymentLine[]): boolean {
  if (!Array.isArray(stored) || stored.length !== submitted.length) return false;
  return stored.every(
    (entry, index) =>
      isRecord(entry) &&
      entry["id"] === submitted[index]?.id &&
      entry["qty"] === submitted[index]?.qty,
  );
}

function sameAddress(storedValue: unknown, submitted: PaymentAddress): boolean {
  if (!isRecord(storedValue)) return false;
  const fields: (keyof PaymentAddress)[] = [
    "name",
    "mobile",
    "address",
    "locality",
    "city",
    "state",
    "pincode",
    "landmark",
    "type",
  ];
  return fields.every((field) => (storedValue[field] ?? "") === (submitted[field] ?? ""));
}

function validateProviderPayment(payment: ProviderPayment, attempt: RazorpayAttempt) {
  validateRazorpayOrderPayment(payment, attempt.razorpay_order_id, attempt.total);
}

function validateProviderQrPayment(payment: ProviderPayment, attempt: RazorpayAttempt) {
  if (attempt.payment_method !== "qr" || !attempt.razorpay_qr_code_id) {
    throw new Error("This payment attempt is not linked to a Razorpay QR code.");
  }
  validateRazorpayQrPayment(payment, attempt.total);
}

async function fetchProviderPayment(paymentId: string): Promise<ProviderPayment> {
  const result = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  return parseProviderPayment(result);
}

async function fetchProviderQrCode(qrCodeId: string, total: number): Promise<ProviderQrCode> {
  const qrCode = parseProviderQrCode(
    await razorpayRequest(`/payments/qr_codes/${encodeURIComponent(qrCodeId)}`),
  );
  if (qrCode.id !== qrCodeId || qrCode.paymentAmount !== total * 100) {
    throw new Error("Razorpay QR code does not match this checkout amount.");
  }
  return qrCode;
}

function qrCodeResult(qrCode: ProviderQrCode) {
  return {
    imageUrl: qrCode.imageUrl,
    expiresAt: qrCode.closeBy * 1000,
  };
}

async function finalizeVerifiedPayment(
  attempt: RazorpayAttempt,
  status: "pending" | "paid" | "failed",
  paymentId: string | null,
  eventId: string | null = null,
) {
  const { data, error } = await supabaseAdmin.rpc("finalize_razorpay_payment", {
    _order_id: attempt.id,
    _payment_status: status,
    _payment_id: paymentId,
    _event_id: eventId,
  });
  if (error) {
    console.error("[Razorpay] Could not update verified payment status", {
      orderId: attempt.id,
      error,
    });
    throw new Error("Could not save Razorpay payment status. Please retry the status check.");
  }
  const result = expectRecord(data, "The database returned an invalid Razorpay payment result.");
  const resultStatus = result["payment_status"];
  if (
    result["order_id"] !== attempt.id ||
    typeof resultStatus !== "string" ||
    typeof result["confirmed_now"] !== "boolean"
  ) {
    throw new Error("The database returned an invalid Razorpay payment result.");
  }
  if (result["confirmed_now"]) await notifyPaidRazorpayOrder(attempt.id);
  return { ...paymentResult(attempt), status: resultStatus };
}

async function notifyPaidRazorpayOrder(orderId: string) {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id,user_id,items,total,address")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) {
    console.error("[Razorpay] Confirmed order could not be loaded for notifications", {
      orderId,
      error,
    });
    return;
  }
  const { data: account, error: accountError } = await supabaseAdmin.auth.admin.getUserById(
    order.user_id,
  );
  if (accountError) {
    console.error("[Razorpay] Could not load customer email for payment notification", {
      orderId,
      error: accountError,
    });
  }
  const address = order.address;
  if (
    !isRecord(address) ||
    typeof address["name"] !== "string" ||
    typeof address["mobile"] !== "string"
  ) {
    console.error("[Razorpay] Confirmed order has invalid delivery details", { orderId });
    return;
  }
  const items = parseAttemptItems(order.items);
  const notice = {
    orderId,
    email: account?.user?.email ?? null,
    name: address["name"],
    mobile: address["mobile"],
    total: order.total,
    items,
    status: "confirmed",
    payment: "razorpay",
  };
  const [customer, owner] = await Promise.all([
    sendOrderNotifications(notice),
    sendOwnerOrderNotifications(notice, {
      name: STORE_CONTACT.name,
      email: STORE_CONTACT.email,
    }),
  ]);
  if (customer.email !== "sent" || owner.email !== "sent") {
    console.error("[Razorpay] Order confirmed but payment notifications were incomplete", {
      orderId,
      customer,
      owner,
    });
  }
}

export async function createRazorpayPaymentOrder(
  userId: string,
  email: string | null,
  lines: PaymentLine[],
  rawAddress: PaymentAddress,
  idempotencyKey: string,
  clearCart: boolean,
  paymentMethod: "razorpay" | "upi" | "qr",
) {
  const config = razorpayConfig();
  const address = validateAddress(rawAddress);
  const existingResult = await supabaseAdmin
    .from("razorpay_payment_orders")
    .select(
      "id,user_id,items,total,address,clear_cart,currency,payment_method,razorpay_order_id,razorpay_qr_code_id,payment_id,status",
    )
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingResult.error) {
    console.error("[Razorpay] Could not check payment idempotency key", existingResult.error);
    throw new Error("Could not start online payment. Please try again.");
  }
  if (existingResult.data) {
    const existing = parseRazorpayAttempt(existingResult.data);
    if (!sameLines(existing.items, lines) || !sameAddress(existing.address, address)) {
      throw new Error("This payment request was already used. Start checkout again.");
    }
    if (existing.payment_method !== paymentMethod) {
      throw new Error("This payment request was already used with a different payment method.");
    }
    if (existing.status === "failed") {
      throw new Error("This payment attempt failed. Start a new payment attempt.");
    }
    if (paymentMethod === "qr") {
      if (existing.status === "creating" || !existing.razorpay_qr_code_id) {
        throw new Error("QR setup is still in progress. Please retry in a few seconds.");
      }
      const current = await checkRazorpayPaymentStatus(userId, existing.id);
      if (current.status !== "pending") return current;
      return { ...current, keyId: config.keyId };
    }
    if (existing.status === "creating" || !existing.razorpay_order_id) {
      throw new Error("Payment setup is still in progress. Please retry in a few seconds.");
    }
    return {
      ...paymentResult(existing),
      keyId: config.keyId,
      razorpayOrderId: existing.razorpay_order_id,
      amount: existing.total * 100,
      currency: existing.currency,
      email,
      name: address.name,
      mobile: address.mobile,
    };
  }

  const { total, items } = await priceOrderLines(lines);
  const internalId = `PF${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const { error: insertError } = await supabaseAdmin.from("razorpay_payment_orders").insert({
    id: internalId,
    user_id: userId,
    idempotency_key: idempotencyKey,
    items,
    total,
    address,
    currency: "INR",
    clear_cart: clearCart,
    payment_method: paymentMethod,
    status: "creating",
  });
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: racedAttempt, error: readError } = await supabaseAdmin
        .from("razorpay_payment_orders")
        .select(
          "id,user_id,items,total,address,clear_cart,currency,payment_method,razorpay_order_id,razorpay_qr_code_id,payment_id,status",
        )
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (!readError && racedAttempt) {
        const existing = parseRazorpayAttempt(racedAttempt);
        if (existing.payment_method !== paymentMethod) {
          throw new Error("This payment request was already used with a different payment method.");
        }
        if (paymentMethod === "qr" && existing.razorpay_qr_code_id && existing.status !== "failed") {
          const current = await checkRazorpayPaymentStatus(userId, existing.id);
          if (current.status !== "pending") return current;
          return { ...current, keyId: config.keyId };
        }
        if (existing.razorpay_order_id && existing.status !== "failed") {
          return {
            ...paymentResult(existing),
            keyId: config.keyId,
            razorpayOrderId: existing.razorpay_order_id,
            amount: existing.total * 100,
            currency: existing.currency,
            email,
            name: address.name,
            mobile: address.mobile,
          };
        }
      }
      if (readError) console.error("[Razorpay] Could not read existing payment attempt", readError);
      throw new Error("Payment setup is already in progress. Please retry in a few seconds.");
    }
    console.error("[Razorpay] Could not create payment record", insertError);
    throw new Error("Could not start online payment. Please try again.");
  }

  let createdQrCodeId: string | null = null;
  try {
    if (paymentMethod === "qr") {
      const closeBy = Math.floor(Date.now() / 1000) + 60 * 60;
      const response = expectRecord(
        await razorpayRequest("/payments/qr_codes", {
          method: "POST",
          body: JSON.stringify({
            type: "upi_qr",
            name: `BIG-B ${internalId}`,
            usage: "single_use",
            fixed_amount: true,
            payment_amount: total * 100,
            description: `Order ${internalId}`,
            close_by: closeBy,
            notes: { bigb_order_id: internalId },
          }),
        }),
        "Razorpay returned an invalid QR code.",
      );
      if (typeof response["id"] === "string") createdQrCodeId = response["id"];
      const qrCode = parseProviderQrCode(response);
      if (qrCode.paymentAmount !== total * 100 || qrCode.status !== "active") {
        throw new Error("Razorpay QR code does not match this checkout.");
      }
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("razorpay_payment_orders")
        .update({ razorpay_qr_code_id: qrCode.id, status: "pending" })
        .eq("id", internalId)
        .eq("status", "creating")
        .select("id")
        .maybeSingle();
      if (updateError || !updated) {
        console.error("[Razorpay] Could not save QR code ID", {
          orderId: internalId,
          error: updateError,
        });
        throw new Error("QR code was created but could not be saved.");
      }
      return {
        ...paymentResult({
          id: internalId,
          user_id: userId,
          items,
          total,
          address,
          clear_cart: clearCart,
          currency: "INR",
          payment_method: paymentMethod,
          razorpay_order_id: null,
          razorpay_qr_code_id: qrCode.id,
          payment_id: null,
          status: "pending",
        }),
        keyId: config.keyId,
        qrCode: qrCodeResult(qrCode),
      };
    }

    const payload = expectRecord(
      await razorpayRequest("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: total * 100,
          currency: "INR",
          receipt: internalId,
          notes: { bigb_order_id: internalId },
          partial_payment: false,
        }),
      }),
      "Razorpay returned an invalid order.",
    );
    const providerOrderId = expectString(payload["id"], "Razorpay returned an invalid order ID.");
    if (
      payload["amount"] !== total * 100 ||
      payload["currency"] !== "INR" ||
      payload["receipt"] !== internalId
    ) {
      throw new Error("Razorpay order does not match this checkout.");
    }
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("razorpay_payment_orders")
      .update({ razorpay_order_id: providerOrderId, status: "pending" })
      .eq("id", internalId)
      .eq("status", "creating")
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      console.error("[Razorpay] Could not save provider order ID", {
        orderId: internalId,
        error: updateError,
      });
      throw new Error("Payment was created but could not be saved. Contact store support.");
    }
    return {
      orderId: internalId,
      total,
      count: items.reduce((sum, item) => sum + item.qty, 0),
      items,
      clearCart,
      paymentMethod,
      status: "pending" as const,
      keyId: config.keyId,
      razorpayOrderId: providerOrderId,
      amount: total * 100,
      currency: "INR",
      email,
      name: address.name,
      mobile: address.mobile,
    };
  } catch (error) {
    let safeToMarkFailed = true;
    if (createdQrCodeId) {
      try {
        await razorpayRequest(
          `/payments/qr_codes/${encodeURIComponent(createdQrCodeId)}/close`,
          { method: "POST" },
        );
      } catch (closeError) {
        safeToMarkFailed = false;
        console.error("[Razorpay] Could not close an unsaved QR code", {
          orderId: internalId,
          qrCodeId: createdQrCodeId,
          error: closeError,
        });
      }
    }
    if (safeToMarkFailed) {
      const { error: updateError } = await supabaseAdmin
        .from("razorpay_payment_orders")
        .update({ status: "failed" })
        .eq("id", internalId)
        .eq("status", "creating");
      if (updateError) {
        console.error("[Razorpay] Could not mark payment setup as failed", {
          orderId: internalId,
          error: updateError,
        });
      }
    }
    if (!safeToMarkFailed) {
      throw new Error("QR setup could not be safely completed. Do not scan it; contact BIG-B support.");
    }
    throw error;
  }
}

async function resolveProviderPayment(attempt: RazorpayAttempt, paymentId: string) {
  const payment = await fetchProviderPayment(paymentId);
  validateProviderPayment(payment, attempt);
  return payment;
}

export async function verifyRazorpayPayment(
  userId: string,
  orderId: string,
  providerOrderId: string,
  paymentId: string,
  signature: string,
) {
  const { keySecret } = razorpayConfig();
  const attempt = await getAttemptById(orderId, userId);
  if (attempt.status === "paid" || attempt.status === "paid_review") {
    return paymentResult(attempt);
  }
  if (providerOrderId !== attempt.razorpay_order_id) {
    throw new Error("Razorpay order does not match your payment request.");
  }
  if (!verifyRazorpayCheckoutSignature(providerOrderId, paymentId, signature, keySecret)) {
    throw new Error("Razorpay payment signature could not be verified.");
  }
  const payment = await resolveProviderPayment(attempt, paymentId);
  const status =
    payment.status === "captured" ? "paid" : payment.status === "failed" ? "failed" : "pending";
  return finalizeVerifiedPayment(attempt, status, payment.id);
}

async function getOrderPayments(orderId: string) {
  const result = expectRecord(
    await razorpayRequest(`/orders/${encodeURIComponent(orderId)}/payments`),
    "Razorpay returned invalid order payment details.",
  );
  if (!Array.isArray(result["items"])) {
    throw new Error("Razorpay returned invalid order payment details.");
  }
  return result["items"].map(parseProviderPayment);
}

async function getQrCodePayments(qrCodeId: string) {
  const result = expectRecord(
    await razorpayRequest(`/payments/qr_codes/${encodeURIComponent(qrCodeId)}/payments`),
    "Razorpay returned invalid QR code payment details.",
  );
  if (!Array.isArray(result["items"])) {
    throw new Error("Razorpay returned invalid QR code payment details.");
  }
  return result["items"].map(parseProviderPayment);
}

async function resolveProviderQrPayment(attempt: RazorpayAttempt, paymentId: string) {
  if (!attempt.razorpay_qr_code_id) {
    throw new Error("This Razorpay payment order has no QR code.");
  }
  const payments = await getQrCodePayments(attempt.razorpay_qr_code_id);
  const payment = payments.find((candidate) => candidate.id === paymentId);
  if (!payment) {
    throw new Error("Razorpay payment was not found on this QR code.");
  }
  validateProviderQrPayment(payment, attempt);
  return payment;
}

export async function checkRazorpayPaymentStatus(userId: string, orderId: string) {
  const attempt = await getAttemptById(orderId, userId);
  if (
    attempt.status === "paid" ||
    attempt.status === "paid_review" ||
    attempt.status === "failed"
  ) {
    return paymentResult(attempt);
  }
  if (attempt.razorpay_qr_code_id) {
    if (attempt.payment_method !== "qr") {
      throw new Error("This Razorpay payment order has an invalid QR code reference.");
    }
    const qrCode = await fetchProviderQrCode(attempt.razorpay_qr_code_id, attempt.total);
    const payments = await getQrCodePayments(qrCode.id);
    for (const payment of payments) validateProviderQrPayment(payment, attempt);
    const successful = payments.find((payment) => payment.status === "captured");
    if (successful) return finalizeVerifiedPayment(attempt, "paid", successful.id);
    const authorized = payments.find((payment) => payment.status === "authorized");
    if (authorized) {
      const result = await finalizeVerifiedPayment(attempt, "pending", authorized.id);
      return { ...result, qrCode: qrCodeResult(qrCode) };
    }
    const active = payments.some((payment) => payment.status === "created");
    if (active) {
      const result = await finalizeVerifiedPayment(attempt, "pending", null);
      return { ...result, qrCode: qrCodeResult(qrCode) };
    }
    const failed = payments.find((payment) => payment.status === "failed");
    if (failed && payments.every((payment) => payment.status === "failed")) {
      return finalizeVerifiedPayment(attempt, "failed", failed.id);
    }
    if (qrCode.status === "closed") {
      return finalizeVerifiedPayment(attempt, "failed", null);
    }
    const result = await finalizeVerifiedPayment(attempt, "pending", null);
    return { ...result, qrCode: qrCodeResult(qrCode) };
  }
  if (!attempt.razorpay_order_id) return paymentResult(attempt);
  const payments = await getOrderPayments(attempt.razorpay_order_id);
  for (const payment of payments) validateProviderPayment(payment, attempt);
  const successful = payments.find((payment) => payment.status === "captured");
  if (successful) return finalizeVerifiedPayment(attempt, "paid", successful.id);
  const failed = payments.find((payment) => payment.status === "failed");
  const authorized = payments.find((payment) => payment.status === "authorized");
  if (authorized) return finalizeVerifiedPayment(attempt, "pending", authorized.id);
  const active = payments.some((payment) => payment.status === "created");
  if (active) return finalizeVerifiedPayment(attempt, "pending", null);
  if (failed && payments.every((payment) => payment.status === "failed")) {
    return finalizeVerifiedPayment(attempt, "failed", failed.id);
  }
  return finalizeVerifiedPayment(attempt, "pending", null);
}

export async function listRazorpayPaymentAttempts(userId: string) {
  const { data: role, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) {
    console.error("[Razorpay] Could not verify seller permissions", roleError);
    throw new Error("Could not verify store permissions. Please refresh and try again.");
  }
  if (!role) throw new Error("You do not have permission to view Razorpay payment attempts.");

  const { data, error } = await supabaseAdmin
    .from("razorpay_payment_orders")
    .select("id,total,address,payment_id,status,created_at")
    .in("status", ["pending", "paid_review"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[Razorpay] Could not load seller payment attempts", error);
    throw new Error("Could not load Razorpay payment attempts. Please refresh and try again.");
  }
  return data.map((attempt) => {
    const address = attempt.address;
    if (!isRecord(address)) throw new Error("A Razorpay attempt has invalid delivery details.");
    return {
      id: attempt.id,
      total: attempt.total,
      status: attempt.status,
      paymentId: attempt.payment_id,
      createdAt: attempt.created_at,
      customerName: typeof address["name"] === "string" ? address["name"] : "Customer",
      customerMobile: typeof address["mobile"] === "string" ? address["mobile"] : "",
    };
  });
}

export async function handleRazorpayWebhook(request: Request): Promise<Response> {
  const { webhookSecret } = razorpayConfig();
  if (!webhookSecret) {
    console.error("[Razorpay] RAZORPAY_WEBHOOK_SECRET is not configured");
    return new Response("Webhook is not configured", { status: 500 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) {
    return new Response("Invalid webhook signature", { status: 400 });
  }
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId || eventId.length > 255) {
    return new Response("Missing webhook event ID", { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Invalid webhook JSON", { status: 400 });
  }
  if (!isRecord(payload) || typeof payload["event"] !== "string") {
    return new Response("Invalid webhook payload", { status: 400 });
  }
  const eventName = payload["event"];
  if (
    eventName !== "qr_code.credited" &&
    eventName !== "payment.captured" &&
    eventName !== "payment.failed" &&
    eventName !== "payment.authorized"
  ) {
    return Response.json({ received: true, ignored: true });
  }
  const eventPayload = isRecord(payload["payload"]) ? payload["payload"] : null;
  const paymentPayload =
    eventPayload && isRecord(eventPayload["payment"]) ? eventPayload["payment"] : null;
  const entity =
    paymentPayload && isRecord(paymentPayload["entity"]) ? paymentPayload["entity"] : null;
  if (!entity || typeof entity["id"] !== "string") {
    return new Response("Invalid payment webhook payload", { status: 400 });
  }

  try {
    if (eventName === "qr_code.credited") {
      const qrPayload =
        eventPayload && isRecord(eventPayload["qr_code"]) ? eventPayload["qr_code"] : null;
      const qrEntity = qrPayload && isRecord(qrPayload["entity"]) ? qrPayload["entity"] : null;
      if (!qrEntity || typeof qrEntity["id"] !== "string") {
        return new Response("Invalid QR code webhook payload", { status: 400 });
      }
      const attempt = await getAttemptByQrCodeId(qrEntity["id"]);
      if (!attempt) return Response.json({ received: true, ignored: true });
      const payment = await resolveProviderQrPayment(attempt, entity["id"]);
      const status =
        payment.status === "captured" ? "paid" : payment.status === "failed" ? "failed" : "pending";
      await finalizeVerifiedPayment(attempt, status, payment.id, eventId);
      return Response.json({ received: true });
    }
    if (typeof entity["order_id"] !== "string") {
      return new Response("Invalid payment webhook payload", { status: 400 });
    }
    const attempt = await getAttemptByProviderId(entity["order_id"]);
    if (!attempt) return Response.json({ received: true, ignored: true });
    const payment = await resolveProviderPayment(attempt, entity["id"]);
    const status =
      payment.status === "captured" ? "paid" : payment.status === "failed" ? "failed" : "pending";
    await finalizeVerifiedPayment(attempt, status, payment.id, eventId);
    return Response.json({ received: true });
  } catch (error) {
    console.error("[Razorpay] Webhook processing failed", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}
