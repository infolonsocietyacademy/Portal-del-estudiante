create table public.olfx_copy_groups (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references public.profiles(id) on delete cascade,
 settings jsonb not null,
 mode text not null default 'paper' check (mode in ('paper','demo')),
 paused boolean not null default true,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now()
);
create table public.olfx_copy_runtime (
 group_id uuid primary key references public.olfx_copy_groups(id) on delete cascade,
 agent_id uuid not null references public.olon_own_agents(id),
 revision bigint not null,
 state text not null check (state in ('paused','paper','demo','error')),
 last_seen_at timestamptz not null default now(),
 followers jsonb not null default '{}'
);
alter table public.olfx_copy_groups enable row level security;
alter table public.olfx_copy_runtime enable row level security;
-- Authenticated reads require ownership; all writes go through the validated API.
revoke all on public.olfx_copy_groups, public.olfx_copy_runtime from anon,authenticated;
grant select on public.olfx_copy_groups, public.olfx_copy_runtime to authenticated;
grant all on public.olfx_copy_groups, public.olfx_copy_runtime to service_role;
create policy copy_group_owner on public.olfx_copy_groups for select to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active'));
create policy copy_runtime_owner on public.olfx_copy_runtime for select to authenticated
 using (exists(select 1 from public.olfx_copy_groups g where g.id=group_id and g.owner_id=(select auth.uid())));
