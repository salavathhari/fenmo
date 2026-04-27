function parseAmountToPaise(rawAmount) {
  if (rawAmount === null || rawAmount === undefined) {
    return { ok: false, message: "amount is required" };
  }

  const normalized = String(rawAmount).trim();
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);

  if (!match) {
    return {
      ok: false,
      message: "amount must be a positive number with up to 2 decimal places"
    };
  }

  const rupees = Number(match[1]);
  const paisePart = match[2] ? match[2].padEnd(2, "0") : "00";
  const paise = Number(paisePart);
  const totalPaise = rupees * 100 + paise;

  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    return { ok: false, message: "amount must be a positive value" };
  }

  return { ok: true, value: totalPaise };
}

function formatPaiseToAmount(paise) {
  const safePaise = Number(paise);
  const isNegative = safePaise < 0;
  const absolute = Math.abs(safePaise);
  const rupees = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${isNegative ? "-" : ""}${rupees}.${remainder}`;
}

module.exports = {
  parseAmountToPaise,
  formatPaiseToAmount
};
