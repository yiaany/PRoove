/**
 * checkout.test.ts — Existing passing tests for the checkout module.
 *
 * These tests pass on BOTH the base (correct) and head (buggy) revisions.
 * They do NOT catch the negative-price regression (that's the PRoove bot's job).
 */

import { describe, it, expect } from "vitest";
import { applyDiscount, calculateTotal, applyCoupon } from "../src/checkout.js";

describe("applyDiscount", () => {
  it("applies a 20% discount correctly", () => {
    expect(applyDiscount(100, 20)).toBe(80);
  });

  it("applies a 50% discount correctly", () => {
    expect(applyDiscount(200, 50)).toBe(100);
  });

  it("zero discount returns original price", () => {
    expect(applyDiscount(50, 0)).toBe(50);
  });

  it("full 100% discount returns 0", () => {
    expect(applyDiscount(99.99, 100)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    expect(applyDiscount(10, 33)).toBe(6.7);
  });
});

describe("calculateTotal", () => {
  it("sums a single item", () => {
    expect(calculateTotal([{ name: "Widget", price: 9.99, quantity: 3 }])).toBe(29.97);
  });

  it("sums multiple items", () => {
    expect(
      calculateTotal([
        { name: "A", price: 10, quantity: 2 },
        { name: "B", price: 5.5, quantity: 4 },
      ]),
    ).toBe(42);
  });

  it("empty cart returns 0", () => {
    expect(calculateTotal([])).toBe(0);
  });
});

describe("applyCoupon", () => {
  it("applies coupon to subtotal", () => {
    expect(applyCoupon(100, 10)).toBe(90);
  });

  it("full coupon returns 0", () => {
    expect(applyCoupon(50, 100)).toBe(0);
  });
});
