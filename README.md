# AI Audiobook Backend (QA Enviroment)

This repository contains the Supabase Edge Functions for the AI Audiobook
project's QA environment.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (recommended for local development)
- [Docker](https://docs.docker.com/get-docker/) (required for local Supabase)

## Getting Started

1. **Login to Supabase:**

   ```bash
   supabase login
   ```

2. **Start Supabase locally:**

   ```bash
   supabase start
   ```

3. **Serve Functions Locally:**

   To run the functions locally for development:

   ```bash
   supabase functions serve
   ```

## Project Structure

- `supabase/functions/`: Edge functions directory
  - `login/`, `signUp/`, `refreshToken/`, `forgotPassword/`, `resetPassword/`:
    Authentication endpoints
  - `_shared/`: Shared utilities (types, validators, clients, helpers)
- `supabase/migrations/`: Database migrations
- `supabase/config.toml`: Supabase configuration
- `docs/`: API documentation (OpenAPI spec + Swagger UI)

## Documentation

See the [`docs/`](./docs) folder for complete API documentation:

- **Swagger UI**: Open `docs/index.html` for interactive API testing
- **OpenAPI Spec**: See `docs/openapi.yml` for the complete API specification
- **Security Guide**: See `docs/SECURITY.md` for security architecture and best
  practices

## Deployment

### Deploy Database Migrations

```bash
supabase db push
```

### Deploy Edge Functions

```bash
# Deploy individual function
supabase functions deploy login

# Deploy all authentication functions
supabase functions deploy login
supabase functions deploy signUp
supabase functions deploy refreshToken
supabase functions deploy forgotPassword
supabase functions deploy resetPassword
```

## Available Functions

| Function         | Endpoint          | Description            | Auth Required |
| ---------------- | ----------------- | ---------------------- | ------------- |
| `login`          | `/login`          | Authenticate user      | No            |
| `signUp`         | `/signUp`         | Register new user      | No            |
| `refreshToken`   | `/refreshToken`   | Refresh access token   | No            |
| `forgotPassword` | `/forgotPassword` | Request password reset | No            |
| `resetPassword`  | `/resetPassword`  | Reset password         | No            |

## Security

This project implements comprehensive security measures:

- **Row Level Security (RLS)** on all database tables
- **JWT authentication** for protected endpoints
- **User isolation** - users can only access their own data
- See [`docs/SECURITY.md`](./docs/SECURITY.md) for complete security
  documentation

## Database Schema

### Users Table

- `id`: UUID (references auth.users)
- `full_name`: User's full name
- `email`: Email address
- `phone`: Phone number
- `publisher_name`: Publisher name
- `user_type`: Access level (ADMIN, MEMBER, OWNER)
- `role`: Job title
- `industry`: Industry name
- `profile_picture_id`: Reference to profile_pictures table

### Profile Pictures Table

- `id`: UUID
- `url`: Picture URL

## Development Guidelines

When creating new endpoints:

1. **Review [`docs/SECURITY.md`](./docs/SECURITY.md)** for security best
   practices
2. **Use auth helpers** from `_shared/auth-helpers.ts` for protected endpoints
3. **Add RLS policies** for any new tables
4. **Update OpenAPI spec** in `docs/openapi.yml`
5. **Test thoroughly** with different user roles

## Environment Variables

Required environment variables (automatically set by Supabase):

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (for admin operations)

## License

[Your License Here]
