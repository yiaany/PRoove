# PRoove Demo — Behavior Contract (SPEC.md)

This file documents the **expected behavior** of the `checkout` module.
The PRoove bot uses this as the authoritative behavior contract when analyzing pull requests.

## Rules

1. **Non-negative price**: `applyDiscount(price, discountPercent)` MUST return a value ≥ 0.
   The discounted price MUST NOT be negative; a discount greater than the item price should result in a price of 0.00.

2. **Correct arithmetic**: `applyDiscount(100, 20)` MUST return `80.00` (20% off $100).

3. **Zero discount**: `applyDiscount(price, 0)` MUST return the original `price` unchanged.

4. **Full discount**: `applyDiscount(price, 100)` MUST return `0.00`.

5. **Rounding**: All returned prices are rounded to 2 decimal places.

6. **Cart total**: `calculateTotal(items)` MUST sum all item totals (quantity × price) correctly.

7. **Coupon stacking**: A coupon applies once to the cart subtotal, not per-item.
