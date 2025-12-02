"use strict";
/**
 * A sample module demonstrating documentation drift detection
 * These examples show various types of drift that Drift can detect
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateArea = calculateArea;
exports.formatUserName = formatUserName;
exports.processPayment = processPayment;
exports.isValidEmail = isValidEmail;
exports.sumArray = sumArray;
/**
 * Calculate the area of a rectangle
 * @param width - The width of the rectangle
 * @param height - The height of the rectangle
 * @param depth - The depth for 3D calculations (DRIFT: This parameter doesn't exist!)
 * @returns The area as a number
 */
function calculateArea(width, height) {
    return width * height;
}
/**
 * Format a user's full name
 * @param firstName - The user's first name
 * @param lastName - The user's last name
 * @returns {string} The formatted full name
 */
function formatUserName(first, last, middleName) {
    // DRIFT: Parameters were renamed from firstName/lastName to first/last
    // DRIFT: New parameter middleName is not documented
    if (middleName) {
        return `${first} ${middleName} ${last}`;
    }
    return `${first} ${last}`;
}
/**
 * Process a payment transaction
 * @param amount - The payment amount
 * @param currency - The currency code (e.g., 'USD')
 * @param cardNumber - The card number to charge (DRIFT: This was removed for security!)
 * @returns {boolean} True if payment was successful
 */
async function processPayment(amount, currency, paymentMethodId // Changed from cardNumber to paymentMethodId
) {
    // DRIFT: Return type changed from boolean to an object
    // The documentation says it returns boolean, but it actually returns an object
    return {
        success: true,
        transactionId: `txn_${Date.now()}`
    };
}
/**
 * Validates an email address using the `validateEmailFormat` helper
 * @param email - The email to validate
 * @returns True if valid
 */
function isValidEmail(email) {
    // DRIFT: The description references `validateEmailFormat` which doesn't exist in this code
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
/**
 * This documentation is perfectly in sync with its code
 * @param items - Array of numbers to sum
 * @returns The sum of all items
 */
function sumArray(items) {
    return items.reduce((acc, item) => acc + item, 0);
}
//# sourceMappingURL=sample-drift.js.map