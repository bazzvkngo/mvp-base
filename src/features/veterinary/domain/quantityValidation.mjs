export function isValidVeterinaryQuantity(value) {
  const quantity = Number(value);

  return Number.isFinite(quantity) &&
    quantity > 0;
}
