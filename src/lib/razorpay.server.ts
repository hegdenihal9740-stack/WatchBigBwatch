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
  type RazorpayPaymentRecord,
} from "@/lib/razorpay-payment-validation";

type RazorpayStatus = "creating" | "pending" | "paid" | "paid_review" | "failed";
type ProviderStatus = RazorpayPaymentRecord["status"];

type RazorpayAttempt = {
  id: string;
  user_id: string;
  items: unknown;
  total: number;
  address: unknown;
  clear_cart: boolean;
  currency: string;
  razorpay_order_id: string | null;
  payment_id: string | null;
  status: RazorpayStatus;
};

type ProviderPayment = RazorpayPaymentRecord;

type PaymentResult = ReturnType<typeof paymentResult>;
type RazorpayPaymentOrderResponse =
  | (Omit<PaymentResult, "status"> & {
      status: "pending";
      keyId: string;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      email: string | null;
      name: string;
      mobile: string;
    })
  | (Omit<PaymentResult, "status"> & {
      status: "paid" | "paid_review" | "failed";
    });

const paymentAttemptSelection =
  "id,user_id,items,total,address,clear_cart,currency,razorpay_order_id,payment_id,status";

function paymentStorageError(error: unknown): Error {
  const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : null;
  if (code && ["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) {
    return new Error(
      "Razorpay payment storage is not set up in Supabase. Apply migration 20261029064858_razorpay_payment_orders, then retry.",
    );
  }
  return new Error(
    "Could not prepare your Razorpay payment. Check the server Supabase setup and retry.",
  );
}

function parseRazorpayAttempt(
  attempt: Omit<RazorpayAttempt, "status"> & { status: string },
): RazorpayAttempt {
  const { status } = attempt;
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
    const code = typeof body["code"] === "string" ? body["code"] : "unknown";
    const reason = typeof body["reason"] === "string" ? body["reason"] : undefined;
    const field = typeof body["field"] === "string" ? body["field"] : undefined;
    console.error("[Razorpay] Provider request failed", {
      status: response.status,
      code,
      ...(reason ? { reason } : {}),
      ...(field ? { field } : {}),
    });
    if (response.status === 401) {
      throw new Error(
        "Razorpay rejected the API credentials. Check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are a matching pair from the same Razorpay account and mode.",
      );
    }
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
    method: typeof payment["method"] === "string" ? payment["method"] : null,
  };
}

function parsePaymentAddress(value: unknown): PaymentAddress {
  const address = expectRecord(value, "Payment order contains invalid delivery details.");
  const optionalString = (key: string) => {
    const field = address[key];
    if (field !== undefined && typeof field !== "string") {
      throw new Error("Payment order contains invalid delivery details.");
    }
    return field;
  };
  return validateAddress({
    name: expectString(address["name"], "Payment order contains invalid delivery details."),
    mobile: expectString(address["mobile"], "Payment order contains invalid delivery details."),
    address: expectString(address["address"], "Payment order contains invalid delivery details."),
    city: expectString(address["city"], "Payment order contains invalid delivery details."),
    state: expectString(address["state"], "Payment order contains invalid delivery details."),
    pincode: expectString(address["pincode"], "Payment order contains invalid delivery details."),
    locality: optionalString("locality"),
    landmark: optionalString("landmark"),
    type: optionalString("type"),
  });
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
    paymentMethod: "razorpay" as const,
    status: attempt.status,
  };
}

async function getAttemptById(orderId: string, userId?: string): Promise<RazorpayAttempt> {
  let query = supabaseAdmin
    .from("razorpay_payment_orders")
    .select(paymentAttemptSelection)
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
    .select(paymentAttemptSelection)
    .eq("razorpay_order_id", providerOrderId)
    .maybeSingle();
  if (error) {
    console.error("[Razorpay] Could not match provider order", { providerOrderId, error });
    throw new Error("Could not match this Razorpay payment to a store order.");
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

async function fetchProviderPayment(paymentId: string): Promise<ProviderPayment> {
  const result = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  return parseProviderPayment(result);
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

async function responseForExistingPayment(
  attempt: RazorpayAttempt,
  keyId: string,
  email: string | null,
  address: PaymentAddress,
): Promise<RazorpayPaymentOrderResponse> {
  if (
    attempt.status === "paid" ||
    attempt.status === "paid_review" ||
    attempt.status === "failed"
  ) {
    return { ...paymentResult(attempt), status: attempt.status };
  }
  if (attempt.status === "creating") {
    throw new Error("Payment setup is still in progress. Please retry in a few seconds.");
  }
  if (!attempt.razorpay_order_id) {
    throw new Error("Payment setup is still in progress. Please retry in a few seconds.");
  }
  return {
    ...paymentResult(attempt),
    status: "pending",
    keyId,
    razorpayOrderId: attempt.razorpay_order_id,
    amount: attempt.total * 100,
    currency: attempt.currency,
    email,
    name: address.name,
    mobile: address.mobile,
  };
}

export async function createRazorpayPaymentOrder(
  userId: string,
  email: string | null,
  lines: PaymentLine[],
  rawAddress: PaymentAddress,
  idempotencyKey: string,
  clearCart: boolean,
): Promise<RazorpayPaymentOrderResponse> {
  const config = razorpayConfig();
  const address = validateAddress(rawAddress);
  const existingResult = await supabaseAdmin
    .from("razorpay_payment_orders")
    .select(paymentAttemptSelection)
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingResult.error) {
    console.error("[Razorpay] Could not check payment idempotency key", existingResult.error);
    throw paymentStorageError(existingResult.error);
  }
  if (existingResult.data) {
    const existing = parseRazorpayAttempt(existingResult.data);
    if (
      !sameLines(existing.items, lines) ||
      !sameAddress(existing.address, address) ||
      existing.clear_cart !== clearCart
    ) {
      throw new Error("This payment request was already used. Start checkout again.");
    }
    return responseForExistingPayment(existing, config.keyId, email, address);
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
    status: "creating",
  });
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: racedAttempt, error: readError } = await supabaseAdmin
        .from("razorpay_payment_orders")
        .select(paymentAttemptSelection)
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (!readError && racedAttempt) {
        const existing = parseRazorpayAttempt(racedAttempt);
        if (
          sameLines(existing.items, lines) &&
          sameAddress(existing.address, address) &&
          existing.clear_cart === clearCart
        ) {
          return responseForExistingPayment(existing, config.keyId, email, address);
        }
      }
      if (readError) console.error("[Razorpay] Could not read existing payment attempt", readError);
      throw new Error("Payment setup is already in progress. Please retry in a few seconds.");
    }
    console.error("[Razorpay] Could not create payment record", insertError);
    throw paymentStorageError(insertError);
  }

  try {
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
      paymentMethod: "razorpay",
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
    throw error;
  }
}

export async function resumeRazorpayPaymentOrder(
  userId: string,
  orderId: string,
  email: string | null,
) {
  const attempt = await getAttemptById(orderId, userId);
  if (attempt.status !== "pending") {
    throw new Error("This Razorpay payment is no longer pending. Check its current status.");
  }
  const address = parsePaymentAddress(attempt.address);
  return responseForExistingPayment(attempt, razorpayConfig().keyId, email, address);
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

export async function checkRazorpayPaymentStatus(userId: string, orderId: string) {
  const attempt = await getAttemptById(orderId, userId);
  if (
    attempt.status === "paid" ||
    attempt.status === "paid_review" ||
    attempt.status === "failed"
  ) {
    return paymentResult(attempt);
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
