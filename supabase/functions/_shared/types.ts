// User type enum
export enum UserType {
    ADMIN = "ADMIN",
    MEMBER = "MEMBER",
    OWNER = "OWNER",
}

// Profile picture interface
export interface ProfilePicture {
    id: string;
    url: string;
}

// Industry interface
export interface Industry {
    id: string;
    industryName: string;
}

// User profile interface
export interface User {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    publisherName: string | null;
    userType: UserType;
    role: string | null;
    industry: Industry | null;
    profilePicture: ProfilePicture | null;
    is2FAEnabled: boolean;
}

// API Response interfaces
export interface SuccessResponse<T = any> {
    status: "success";
    message: string;
    [key: string]: any;
}

export interface ErrorResponse {
    status: "error";
    message: string;
    errors?: string[];
}

// Login request/response
export interface LoginRequest {
    email: string;
    password: string;
}

export interface LoginResponse extends SuccessResponse {
    token: string;
    refreshToken: string;
    expiresIn: number;
    userType: UserType;
    user: User;
    mfaRequired?: boolean;
}

// SignUp request/response
export interface SignUpRequest {
    email: string;
    password: string;
    fullName: string;
}

export interface SignUpResponse extends SuccessResponse {
    user: User;
}

// RefreshToken request/response
export interface RefreshTokenRequest {
    refreshToken: string;
}

export interface RefreshTokenResponse extends SuccessResponse {
    token: string;
    refreshToken: string;
    expiresIn: number;
}

// ForgotPassword request/response
export interface ForgotPasswordRequest {
    email: string;
}

// ResetPassword request/response

export interface ResetPasswordRequest {
    access_token: string;
    newPassword: string;
}

// MFA Verify/Enroll Complete Response
export interface MfaVerifyResponse extends SuccessResponse {
    access_token: string;
    refresh_token: string;
}
