import type { ErrorResponse, SuccessResponse } from "./types.ts";

/**
 * CORS headers for API responses
 */
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Creates a success response with consistent structure
 */
export function successResponse<T extends SuccessResponse>(
    data: T,
    status: number = 200,
): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
        },
    });
}

/**
 * Creates an error response with consistent structure
 */
export function errorResponse(
    message: string,
    status: number = 400,
    errors?: string[],
): Response {
    const data: ErrorResponse = {
        status: "error",
        message,
    };

    if (errors && errors.length > 0) {
        data.errors = errors;
    }

    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
        },
    });
}

/**
 * Handles OPTIONS requests for CORS preflight
 */
export function handleCorsPreFlight(): Response {
    return new Response(null, {
        status: 204,
        headers: corsHeaders,
    });
}
