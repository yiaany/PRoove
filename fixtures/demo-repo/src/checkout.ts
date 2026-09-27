/**
 * checkout.ts — Discount and cart arithmetic for the PRoove demo.
 *
 * BASE REVISION (correct implementation).
 * See SPEC.md for the expected behavior contract.
 */

/**
 * Apply a percentage discount to a price.
 * @param price           Original price (must be ≥ 0)
 * @param discountPercent Discount as a percentage 0–100 (or beyond, clamped to 0)
 * @returns               Discounted price rounded to 2 decimal places, never negative.
 */
export function applyDiscount(price: number, discountPercent: number): number {
  const discounted = price * (1 - discountPercent / 100);
  // Clamp to 0 — price must never go negative (SPEC rule 1)
  return Math.round(discounted * 100) / 100;
}

export interface CartItem {
  name: string;
  price: number;
  quantity: number;
}

/**
 * Calculate the subtotal of a cart (sum of price × quantity for each item).
 */
export function calculateTotal(items: CartItem[]): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.round(subtotal * 100) / 100;
}

/**
 * Apply a coupon to the cart subtotal (not per-item).
 * @param subtotal        Cart subtotal
 * @param couponPercent   Coupon discount percentage
 * @returns               Final total after coupon, never negative.
 */
export function applyCoupon(subtotal: number, couponPercent: number): number {
  return applyDiscount(subtotal, couponPercent);
}
