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

- `supabase/functions/api`: Main API entry point.
- `supabase/config.toml`: Supabase configuration.

## Deployment

To deploy the functions to the remote Supabase project:

```bash
supabase functions deploy api
```
