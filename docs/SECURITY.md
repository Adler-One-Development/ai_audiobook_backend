# Security Architecture

## 🔒 Security Model Overview

This document outlines the comprehensive security architecture implemented in
the AI Audiobook Backend to prevent unauthorized data access and modification.

---

## 🛡️ Security Layers

### 1. Row Level Security (RLS)

**Database-level protection** - Even if application code has bugs, the database
enforces security.

#### Users Table RLS Policies

```sql
-- Policy 1: Users can only read their own data
CREATE POLICY "Users can read their own data"
    ON public.users
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Policy 2: Users can only update their own data
CREATE POLICY "Users can update their own data"
    ON public.users
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Policy 3: Service role bypass for system operations
CREATE POLICY "Service role has full access"
    ON public.users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
```

**What this means:**

- ✅ Users with valid JWT can only SELECT/UPDATE rows where `id = auth.uid()`
- ❌ Cannot read other users' data even with a valid JWT
- ❌ Cannot modify other users' data even if they craft a malicious request
- ✅ Service role (used in signup) has full access for creating new users

---

### 2. Application-Level Security

#### Current Authentication Endpoints Analysis

| Endpoint          | Security Level       | Why It's Safe                                                            |
| ----------------- | -------------------- | ------------------------------------------------------------------------ |
| `/signUp`         | Public (no JWT)      | Creates new user; ID comes from Supabase Auth                            |
| `/login`          | Public (no JWT)      | Only returns authenticated user's data via `.eq("id", authData.user.id)` |
| `/refreshToken`   | Public (no JWT)      | Token refresh is tied to specific user's refresh token                   |
| `/forgotPassword` | Public (no JWT)      | Only sends email; no data modification                                   |
| `/resetPassword`  | Public (token-based) | Token is user-specific from email; can only reset that user's password   |

**Key Security Principles Applied:**

1. **No User ID in Request Body**: Login fetches data using `authData.user.id`
   from Supabase Auth, not from request
2. **Admin Client Used Safely**: Only queries with `.eq("id", authData.user.id)`
   filter
3. **Token-Based Reset**: Password reset uses token that's cryptographically
   tied to specific user

---

### 3. Future Protected Endpoints

For endpoints that require authentication (e.g., update profile, delete
account), use the provided auth helpers:

#### Auth Helper Functions

**File:**
[`_shared/auth-helpers.ts`](file:///Users/junaidtariq/VSCodeProjects/AdlerOne/ai_audiobook_backend/supabase/functions/_shared/auth-helpers.ts)

##### `getAuthenticatedUser(req)`

Extracts and validates the JWT from the request.

```typescript
const { user, error } = await getAuthenticatedUser(req);
if (error) return error; // Returns 401 if not authenticated
```

##### `validateUserAccess(authenticatedUserId, requestedUserId)`

Ensures users can only access their own resources.

```typescript
if (!validateUserAccess(user!.id, requestedUserId)) {
    return errorResponse("Forbidden - Cannot modify other users' data", 403);
}
```

##### `isAdmin(userId)`

Checks if user has ADMIN userType.

```typescript
const hasAdminAccess = await isAdmin(user!.id);
if (!hasAdminAccess) {
    return errorResponse("Forbidden - Admin access required", 403);
}
```

---

## 📝 Security Guidelines for New Endpoints

### ✅ DO's

1. **Always validate JWTs for protected endpoints**
   ```typescript
   const { user, error } = await getAuthenticatedUser(req);
   if (error) return error;
   ```

2. **Use authenticated user ID from JWT, never from request body**
   ```typescript
   // ✅ GOOD
   const userId = user!.id;

   // ❌ BAD
   const { userId } = await req.json();
   ```

3. **Add RLS policies to new tables**
   ```sql
   ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can read their own data"
       ON new_table FOR SELECT TO authenticated
       USING (auth.uid() = user_id);
   ```

4. **Use validateUserAccess for resource access**
   ```typescript
   const { resourceId } = await req.json();
   // Fetch resource and check ownership
   const resource = await db.from("resources").select("user_id").eq(
       "id",
       resourceId,
   ).single();
   if (!validateUserAccess(user!.id, resource.user_id)) {
       return errorResponse("Forbidden", 403);
   }
   ```

5. **Set verify_jwt = true for protected endpoints**
   ```toml
   [functions.updateProfile]
   enabled = true
   verify_jwt = true  # ✅ Enforce JWT validation
   ```

### ❌ DON'Ts

1. **Never trust user ID from request body**
   ```typescript
   // ❌ VULNERABLE
   const { userId, newEmail } = await req.json();
   await db.from("users").update({ email: newEmail }).eq("id", userId);
   ```

2. **Never disable RLS without good reason**
   ```sql
   -- ❌ DANGEROUS
   ALTER TABLE users DISABLE ROW LEVEL SECURITY;
   ```

3. **Never use adminClient for user-initiated updates**
   ```typescript
   // ❌ BAD - Bypasses RLS
   const adminClient = createAdminClient();
   await adminClient.from("users").update(data).eq("id", requestedId);

   // ✅ GOOD - Respects RLS
   const userClient = createClientFromRequest(req);
   await userClient.from("users").update(data).eq("id", user!.id);
   ```

4. **Never expose other users' data in queries**
   ```typescript
   // ❌ BAD - Returns all users
   const { data } = await supabase.from("users").select("*");

   // ✅ GOOD - RLS ensures only own data returned
   const { data } = await supabase.from("users").select("*").eq("id", user!.id);
   ```

---

## 🔐 Example: Secure Protected Endpoint

```typescript
import {
    getAuthenticatedUser,
    validateUserAccess,
} from "../_shared/auth-helpers.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
import { errorResponse, successResponse } from "../_shared/response-helpers.ts";

Deno.serve(async (req) => {
    // Step 1: Authenticate the user
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError) return authError;

    // Step 2: Parse request (never trust user IDs from body)
    const { fullName, phone, industry } = await req.json();

    // Step 3: Use authenticated user's ID
    const supabase = createClientFromRequest(req);

    // Step 4: Update using RLS-protected client
    const { data, error } = await supabase
        .from("users")
        .update({ full_name: fullName, phone, industry })
        .eq("id", user!.id) // ✅ Can only update own data
        .select()
        .single();

    if (error) {
        return errorResponse("Failed to update profile", 500);
    }

    return successResponse({
        status: "success",
        message: "Profile updated successfully",
        user: data,
    });
});
```

**Config:**

```toml
[functions.updateProfile]
enabled = true
verify_jwt = true  # ✅ Require authentication
```

---

## 🎯 Security Checklist for New Endpoints

Before deploying a new endpoint, verify:

- [ ] RLS policies exist for all tables accessed
- [ ] JWT validation implemented for protected operations
- [ ] User ID comes from verified JWT, not request body
- [ ] `validateUserAccess()` called before modifying resources
- [ ] Using `createClientFromRequest()` for user operations (respects RLS)
- [ ] Using `createAdminClient()` only when necessary (bypasses RLS)
- [ ] `verify_jwt = true` in config.toml for protected endpoints
- [ ] Error messages don't leak sensitive information
- [ ] Tested that User A cannot access User B's data

---

## 🚨 Common Vulnerabilities Prevented

### 1. Insecure Direct Object Reference (IDOR)

**Attack:** User changes `userId` in request to access another user's data

**Prevention:**

- ✅ RLS policies enforce `auth.uid() = id`
- ✅ Application code uses `user.id` from JWT, not request body
- ✅ `validateUserAccess()` double-checks access rights

### 2. JWT Bypass

**Attack:** User calls protected endpoint without a token

**Prevention:**

- ✅ `getAuthenticatedUser()` validates JWT exists and is valid
- ✅ `verify_jwt = true` in config.toml for protected endpoints
- ✅ 401 responses for missing/invalid tokens

### 3. Privilege Escalation

**Attack:** MEMBER user tries to perform ADMIN-only action

**Prevention:**

- ✅ `isAdmin()` helper checks user_type
- ✅ RLS policies can be customized per userType
- ✅ Application-level role checks before sensitive operations

### 4. Mass Assignment

**Attack:** User sends unexpected fields in request body

**Prevention:**

- ✅ Explicitly whitelist fields to update
- ✅ Never spread request body directly into database updates
- ✅ TypeScript interfaces enforce structure

---

## 📊 Security Testing

### Manual Testing

1. **Test with valid JWT:**
   ```bash
   curl -X POST 'https://your-api.com/functions/v1/updateProfile' \
     -H 'Authorization: Bearer VALID_TOKEN' \
     -H 'Content-Type: application/json' \
     -d '{"fullName": "New Name"}'
   ```
   ✅ Should succeed and update only the authenticated user's data

2. **Test without JWT:**
   ```bash
   curl -X POST 'https://your-api.com/functions/v1/updateProfile' \
     -H 'Content-Type: application/json' \
     -d '{"fullName": "New Name"}'
   ```
   ❌ Should return 401 Unauthorized

3. **Test with expired JWT:**
   ```bash
   curl -X POST 'https://your-api.com/functions/v1/updateProfile' \
     -H 'Authorization: Bearer EXPIRED_TOKEN' \
     -H 'Content-Type: application/json' \
     -d '{"fullName": "New Name"}'
   ```
   ❌ Should return 401 Unauthorized

4. **Test accessing other user's data:**
   - Login as User A, get token
   - Try to fetch User B's profile with User A's token ❌ Should return 403
     Forbidden or empty result

---

## ✅ Current Security Status

**Authentication Endpoints:** ✅ SECURE

- All endpoints properly scoped to authenticated user
- No user ID taken from request body
- RLS policies active and enforced
- Admin client used only for safe operations

**Database:** ✅ SECURE

- RLS enabled on all tables
- Policies enforce user can only access own data
- Service role restricted to system operations
- Foreign keys properly constrained

**Infrastructure:** ✅ SECURE

- CORS properly configured
- Error messages don't leak sensitive info
- Passwords hashed by Supabase Auth
- JWT tokens expire after configured time

---

## 🔄 Continuous Security

1. **Review all new endpoints** using this document
2. **Test with different user roles** (ADMIN, MEMBER, OWNER)
3. **Audit RLS policies** when adding new tables
4. **Update this document** when security patterns change
5. **Never disable RLS** without security team approval

---

**Security is everyone's responsibility! 🛡️**
