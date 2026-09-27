import { applyDiscount } from "../fixtures/demo-repo/src/checkout";

const originalPrice = 100;
const discountInput = document.querySelector<HTMLInputElement>("#discount")!;
const discountAmount = document.querySelector<HTMLElement>("#discount-amount")!;
const finalTotal = document.querySelector<HTMLElement>("#final-total")!;
const totalPanel = document.querySelector<HTMLElement>("#total-panel")!;
const regressionLabel = document.querySelector<HTMLElement>("#regression-label")!;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(amount: number): string {
  return amount < 0 ? `−${usd.format(Math.abs(amount))}` : usd.format(amount);
}

function updateOrder(): void {
  const percentage = discountInput.valueAsNumber;

  if (!Number.isFinite(percentage) || percentage < 0) {
    discountAmount.textContent = "—";
    finalTotal.textContent = "—";
    totalPanel.classList.remove("is-regression");
    regressionLabel.hidden = true;
    return;
  }

  // All checkout arithmetic comes from the fixture; the summary merely shows
  // the difference between the original price and the returned final total.
  const total = applyDiscount(originalPrice, percentage);
  discountAmount.textContent = formatMoney(total - originalPrice);
  finalTotal.textContent = formatMoney(total);

  const isRegression = total < 0;
  totalPanel.classList.toggle("is-regression", isRegression);
  regressionLabel.hidden = !isRegression;
}

discountInput.addEventListener("input", updateOrder);
updateOrder();
