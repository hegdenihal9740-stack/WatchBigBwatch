import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { getPaymentTotal } from "@/lib/payment";
import {
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "@/lib/razorpay-signature";

describe("server order totals", () => {
  it("verifies Razorpay checkout signatures against the exact order and payment IDs", () => {
    const secret = "test-key-secret";
    const orderId = "order_test_123";
    const paymentId = "pay_test_456";
    const signature = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

    expect(verifyRazorpayCheckoutSignature(orderId, paymentId, signature, secret)).toBe(true);
    expect(verifyRazorpayCheckoutSignature(orderId, paymentId, signature, "wrong-secret")).toBe(
      false,
    );
    expect(verifyRazorpayCheckoutSignature("order_other", paymentId, signature, secret)).toBe(
      false,
    );
    expect(verifyRazorpayCheckoutSignature(orderId, paymentId, "not-a-signature", secret)).toBe(
      false,
    );
  });

  it("verifies Razorpay webhook signatures over the unchanged raw body", () => {
    const body = '{"event":"payment.captured"}';
    const secret = "test-webhook-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyRazorpayWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyRazorpayWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, signature, "wrong-secret")).toBe(false);
  });

  it("calculates INR totals from the trusted server catalog", () => {
    expect(
      getPaymentTotal([
        { id: "steel", qty: 1 },
        { id: "gold", qty: 2 },
      ]),
    ).toBe(49800);
  });

  it("prices seller-added watches using server-provided catalog prices", () => {
    expect(getPaymentTotal([{ id: "titanium-diver", qty: 2 }], { "titanium-diver": 22000 })).toBe(
      44000,
    );
  });

  it("uses the current server catalog price for original watches", () => {
    expect(getPaymentTotal([{ id: "steel", qty: 1 }], { steel: 13000 })).toBe(13000);
  });

  it("rejects custom watches that are not present in the active catalog", () => {
    expect(() => getPaymentTotal([{ id: "unknown-watch", qty: 1 }])).toThrow();
  });

  it("rejects duplicate product lines to prevent ambiguous carts", () => {
    expect(() =>
      getPaymentTotal([
        { id: "steel", qty: 1 },
        { id: "steel", qty: 1 },
      ]),
    ).toThrow();
  });

  it("rejects invalid quantities", () => {
    expect(() => getPaymentTotal([{ id: "steel", qty: 0 }])).toThrow();
    expect(() => getPaymentTotal([{ id: "steel", qty: 21 }])).toThrow();
  });
});
