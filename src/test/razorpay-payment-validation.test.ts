import { describe, expect, it } from "vitest";
import {
  validateRazorpayOrderPayment,
  type RazorpayPaymentRecord,
} from "@/lib/razorpay-payment-validation";

const payment: RazorpayPaymentRecord = {
  id: "pay_test",
  amount: 125000,
  currency: "INR",
  status: "captured",
  order_id: "order_test",
  method: "upi",
};

describe("Razorpay payment validation", () => {
  it("accepts an order payment only when order, amount, and currency match", () => {
    expect(() => validateRazorpayOrderPayment(payment, "order_test", 1250)).not.toThrow();
    expect(() => validateRazorpayOrderPayment(payment, "other_order", 1250)).toThrow();
    expect(() =>
      validateRazorpayOrderPayment({ ...payment, amount: 1 }, "order_test", 1250),
    ).toThrow();
    expect(() =>
      validateRazorpayOrderPayment({ ...payment, currency: "USD" }, "order_test", 1250),
    ).toThrow();
  });
});
