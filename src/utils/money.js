export function toCents(amount) {
  if (amount === null || amount === undefined) return null;
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

export function fromCents(cents) {
  if (cents === null || cents === undefined) return null;
  return Number(cents) / 100;
}
