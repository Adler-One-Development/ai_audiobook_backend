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

// Genre interface
export interface Genre {
    id: string;
    genreName: string;
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

// Copyrights API response interfaces
export interface CopyrightsGetResponse extends SuccessResponse {
    data: {
        copyrights_text: string | null;
        updated_at: string | null;
    } | null;
}

export interface CopyrightsSetResponse extends SuccessResponse {
    data: {
        copyrights_text: string | null;
        created_at: string;
        updated_at: string | null;
    };
}

export interface ChangeEmailRequest {
    email: string;
}

// Content models
export interface ContentNode {
    text?: string;
    type: string;
    voice_id?: string;
    // Add other properties as needed
}

export interface ContentBlock {
    nodes: ContentNode[];
    block_id?: string;
    sub_type?: string;
    comments?: any[];
}

export interface Chapter {
    id: string;
    name: string;
    content_json: {
        blocks: ContentBlock[];
    };
}

// Studio API models
export interface StudioBook {
    isbn: string;
    title: string;
    author: string;
    description: string;
    publisher_name: string;
    publication_date: string;
}

export interface StudioChapter {
    id: string;
    name: string;
}

export interface GetStudioResponse {
    book: StudioBook;
    chapters: StudioChapter[];
    gallery_id: string;
}
