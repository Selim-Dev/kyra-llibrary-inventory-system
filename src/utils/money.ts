/**
 * Money formatting utilities.
 * All monetary values are stored as integers (cents) to avoid floating-point precision issues.
 */

/**
 * Format cents to a string representation (e.g., 10050 -> "100.50").
 * Uses integer arithmetic to avoid floating-point errors.
 *
 * @param cents - Amount in cents (integer)
 * @returns Formatted string with 2 decimal places
 */
export function formatMoney(cents: number): string {
  // Ensure we're working with an integer
  const wholeCents = Math.round(cents);
  
  // Handle negative values
  const isNegative = wholeCents < 0;
  const absoluteCents = Math.abs(wholeCents);
  
  // Split into dollars and cents using integer division
  const dollars = Math.floor(absoluteCents / 100);
  const remainingCents = absoluteCents % 100;
  
  // Format with leading zero for cents if needed
  const centsStr = remainingCents.toString().padStart(2, '0');
  
  // Combine with sign
  const sign = isNegative ? '-' : '';
  return `${sign}${dollars}.${centsStr}`;
}

/**
 * Parse a money string to cents.
 * Handles formats like "100.50", "100", "-50.25"
 *
 * @param moneyStr - String representation of money
 * @returns Amount in cents (integer)
 */
export function parseMoney(moneyStr: string): number {
  // Remove any currency symbols and whitespace
  const cleaned = moneyStr.replace(/[^0-9.-]/g, '');
  
  // Handle negative values
  const isNegative = cleaned.startsWith('-');
  const absoluteStr = cleaned.replace('-', '');
  
  // Split on decimal point
  const parts = absoluteStr.split('.');
  const dollars = parseInt(parts[0] || '0', 10);
  
  // Handle cents part - pad or truncate to 2 digits
  let centsStr = parts[1] || '00';
  if (centsStr.length === 1) {
    centsStr = centsStr + '0';
  } else if (centsStr.length > 2) {
    centsStr = centsStr.substring(0, 2);
  }
  const cents = parseInt(centsStr, 10);
  
  // Calculate total cents
  const totalCents = dollars * 100 + cents;
  
  return isNegative ? -totalCents : totalCents;
}

/**
 * Format a monetary response with both cents and formatted string.
 * Used for API responses per requirement 19.5.
 *
 * @param cents - Amount in cents
 * @returns Object with balanceCents and balanceFormatted
 */
export function formatMoneyResponse(cents: number): {
  balanceCents: number;
  balanceFormatted: string;
} {
  return {
    balanceCents: cents,
    balanceFormatted: formatMoney(cents),
  };
}
