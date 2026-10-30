import { describe, expect, it } from "vitest";
import {
  validateRazorpayOrderPayment,
  validateRazorpayQrPayment,
  type RazorpayPaymentRecord,
} from "@/lib/razorpay-payment-validation";

const payment = (overrides: Partial<RazorpayPaymentRecord> = {}): RazorpayPaymentRecord => ({
  id: "pay_test_123",
  order_id: "order_test_123",
  amount: 12500,
  currency: "INR",
  status: "captured",
  method: "upi",
  ...overrides,
});

describe("Razorpay payment validation", () => {
  it("accepts only payments for the matching server-created order and total", () => {
    expect(() => validateRazorpayOrderPayment(payment(), "order_test_123", 125)).not.toThrow();
    expect(() => validateRazorpayOrderPayment(payment(), "order_other", 125)).toThrow();
    expect(() => validateRazorpayOrderPayment(payment(), "order_test_123", 126)).toThrow();
    expect(() => validateRazorpayOrderPayment(payment(), null, 125)).toThrow();
  });

  it("accepts only exact-amount INR UPI payments returned for a QR code", () => {
    expect(() => validateRazorpayQrPayment(payment({ order_id: null }), 125)).not.toThrow();
    expect(() => validateRazorpayQrPayment(payment(), 125)).toThrow();
    expect(() =>
      validateRazorpayQrPayment(payment({ order_id: null, amount: 12400 }), 125),
    ).toThrow();
    expect(() =>
      validateRazorpayQrPayment(payment({ order_id: null, currency: "USD" }), 125),
    ).toThrow();
    expect(() =>
      validateRazorpayQrPayment(payment({ order_id: null, method: "card" }), 125),
    ).toThrow();
  });
});
