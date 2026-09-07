/**
 * Calculate the total price with tax
 * @param price - The base price
 * @param taxRate - The tax rate as a decimal
 * @returns The total price including tax
 */
export function calculateTotal(price: number, tax: number, discount?: number): number {
    return price * (1 + tax) - (discount ?? 0);
}

/**
 * Format a user's full name
 * @param first - First name
 * @param last - Last name
 */
export function formatUserName(first: string, last: string): string {
    return `${first} ${last}`;
}
