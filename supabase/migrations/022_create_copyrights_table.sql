create table public.copyrights (
  organization_id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  copyrights_text text null,
  updated_at timestamp without time zone null,
  id uuid not null default gen_random_uuid (),
  constraint copyrights_pkey primary key (id),
  constraint copyrights_organization_id_key unique (organization_id),
  constraint copyrights_organization_id_fkey foreign KEY (organization_id) references organizations (id) on update CASCADE on delete CASCADE
);

-- RLS Policies (Implicitly needed for security, though not explicitly requested, good practice to add "enable row level security" but I will stick to the requested schema for now, maybe add RLS later if needed or strictly follow user schema which didn't mention RLS but did mention constraints)
-- Actually, the user just asked for the table creation. I will stick to the exact schema provided.
