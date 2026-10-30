import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createCodOrder as createCodOrderOnServer } from "@/lib/payment.server";
import {
  checkRazorpayPaymentStatus as checkRazorpayPaymentStatusOnServer,
  createRazorpayPaymentOrder as createRazorpayPaymentOrderOnServer,
  listRazorpayPaymentAttempts as listRazorpayPaymentAttemptsOnServer,
  verifyRazorpayPayment as verifyRazorpayPaymentOnServer,
} from "@/lib/razorpay.server";

const lineSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  qty: z.number().int().min(1).max(20),
});

const addressSchema = z.object({
  name: z.string().trim().min(1).max(100),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  address: z.string().trim().min(1).max(500),
  locality: z.string().max(150).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().regex(/^\d{6}$/),
  landmark: z.string().max(150).optional(),
  type: z.string().max(30).optional(),
});

export const createCodOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      items: z.array(lineSchema).min(1).max(4),
      address: addressSchema,
    }),
  )
  .handler(async ({ data, context }) =>
    createCodOrderOnServer(
      context.userId,
      data.items,
      data.address,
      context.supabase,
      typeof context.claims["email"] === "string" ? context.claims["email"] : null,
    ),
  );

export const createRazorpayPaymentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      items: z.array(lineSchema).min(1).max(4),
      address: addressSchema,
      idempotencyKey: z.string().uuid(),
      clearCart: z.boolean(),
      paymentMethod: z.enum(["razorpay", "upi", "qr"]),
    }),
  )
  .handler(async ({ data, context }) =>
    createRazorpayPaymentOrderOnServer(
      context.userId,
      typeof context.claims["email"] === "string" ? context.claims["email"] : null,
      data.items,
      data.address,
      data.idempotencyKey,
      data.clearCart,
      data.paymentMethod,
    ),
  );

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      orderId: z.string().regex(/^PF[A-F0-9]{20}$/),
      razorpayOrderId: z.string().min(1).max(64),
      razorpayPaymentId: z.string().min(1).max(64),
      razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
    }),
  )
  .handler(async ({ data, context }) =>
    verifyRazorpayPaymentOnServer(
      context.userId,
      data.orderId,
      data.razorpayOrderId,
      data.razorpayPaymentId,
      data.razorpaySignature,
    ),
  );

export const checkRazorpayPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ orderId: z.string().regex(/^PF[A-F0-9]{20}$/) }))
  .handler(async ({ data, context }) =>
    checkRazorpayPaymentStatusOnServer(context.userId, data.orderId),
  );

export const listRazorpayPaymentAttempts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listRazorpayPaymentAttemptsOnServer(context.userId));
