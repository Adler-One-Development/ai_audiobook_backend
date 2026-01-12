/**
 * Password validation utility
 * Enforces strong password requirements
 */

export interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}

/**
 * Validates password strength
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one number (0-9)
 * - At least one special character (!@#$%^&*)
 */
export function validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];

    // Check minimum length
    if (password.length < 8) {
        errors.push("Password must be at least 8 characters long");
    }

    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
        errors.push(
            "Password must contain at least one uppercase letter (A-Z)",
        );
    }

    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
        errors.push(
            "Password must contain at least one lowercase letter (a-z)",
        );
    }

    // Check for number
    if (!/[0-9]/.test(password)) {
        errors.push("Password must contain at least one number (0-9)");
    }

    // Check for special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push(
            "Password must contain at least one special character (!@#$%^&* etc.)",
        );
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Checks if the new password is different from the old password
 */
export function validatePasswordChange(
    oldPassword: string,
    newPassword: string,
): PasswordValidationResult {
    const errors: string[] = [];

    if (oldPassword === newPassword) {
        errors.push("New password must be different from the old password");
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}
