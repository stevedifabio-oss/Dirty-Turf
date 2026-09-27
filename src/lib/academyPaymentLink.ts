import { Capacitor } from "@capacitor/core";

const STRIPE_PAYMENT_LINK_ORIGIN = "https://buy.stripe.com";

export function normalizeAcademyPaymentLink(value: string | null | undefined) {
  if (!value) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.origin !== STRIPE_PAYMENT_LINK_ORIGIN || url.username || url.password) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function academyPaymentLink(nativePlatform = Capacitor.isNativePlatform()) {
  if (nativePlatform) return undefined;
  return "/membership";
}

export function checkoutReturnNotice(search: string) {
  const state = new URLSearchParams(search).get("checkout");
  if (state === "success") {
    return "Stripe returned you to the Academy. Access activates only after Stripe confirms payment; use the same email from checkout for your secure sign-in link.";
  }
  if (state === "cancelled") {
    return "Checkout was not completed. Your account was not changed.";
  }
  return "";
}
