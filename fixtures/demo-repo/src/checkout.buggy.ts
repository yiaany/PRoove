/**
 * checkout.buggy.ts — HEAD revision with a subtle regression.
 *
 * This is used by scripts/create-demo-repo.ts to create the second commit.
 * The bug: applyDiscount does NOT clamp to 0, so discountPercent > 100
 *          produces a negative price — violating SPEC rule 1.
 *
 * Existing tests still pass (they only test 0–100% discounts).
 * The PRoove bot's proposed regression test catches the negative price.
 */

export function applyDiscount(price: number, discountPercent: number): number {
  // BUG: removed the Math.max(0, ...) clamp — price can go negative
  return Math.round((price * (1 - discountPercent / 100)) * 100) / 100;
}

export interface CartItem {
  name: string;
  price: number;
  quantity: number;
}

export function calculateTotal(items: CartItem[]): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.round(subtotal * 100) / 100;
}

export function applyCoupon(subtotal: number, couponPercent: number): number {
  return applyDiscount(subtotal, couponPercent);
}
