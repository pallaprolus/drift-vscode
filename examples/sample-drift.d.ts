/**
 * A sample module demonstrating documentation drift detection
 * These examples show various types of drift that Drift can detect
 */
/**
 * Calculate the area of a rectangle
 * @param width - The width of the rectangle
 * @param height - The height of the rectangle
 * @param depth - The depth for 3D calculations (DRIFT: This parameter doesn't exist!)
 * @returns The area as a number
 */
declare function calculateArea(width: number, height: number): number;
/**
 * Format a user's full name
 * @param firstName - The user's first name
 * @param lastName - The user's last name
 * @returns {string} The formatted full name
 */
declare function formatUserName(first: string, last: string, middleName?: string): string;
/**
 * Process a payment transaction
 * @param amount - The payment amount
 * @param currency - The currency code (e.g., 'USD')
 * @param cardNumber - The card number to charge (DRIFT: This was removed for security!)
 * @returns {boolean} True if payment was successful
 */
declare function processPayment(amount: number, currency: string, paymentMethodId: string): Promise<{
    success: boolean;
    transactionId: string;
}>;
/**
 * Validates an email address using the `validateEmailFormat` helper
 * @param email - The email to validate
 * @returns True if valid
 */
declare function isValidEmail(email: string): boolean;
/**
 * This documentation is perfectly in sync with its code
 * @param items - Array of numbers to sum
 * @returns The sum of all items
 */
declare function sumArray(items: number[]): number;
export { calculateArea, formatUserName, processPayment, isValidEmail, sumArray };
//# sourceMappingURL=sample-drift.d.ts.map