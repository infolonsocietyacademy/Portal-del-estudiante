-- OLON Society Academy - General Public Chat table
create table if not exists public.general_chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete set null,
  sender_name text not null,
  sender_role text not null check (sender_role in ('admin','student')),
  message text not null,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

alter table public.general_chat_messages enable row level security;

drop policy if exists "open_general_chat_messages" on public.general_chat_messages;

create policy "open_general_chat_messages"
on public.general_chat_messages
for all
using (true)
with check (true);

create index if not exists general_chat_messages_created_at_idx
on public.general_chat_messages(created_at);

create index if not exists general_chat_messages_sender_id_idx
on public.general_chat_messages(sender_id);
