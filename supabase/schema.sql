create table public.room_participants (
  room_id text not null,
  participant_id text not null,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  last_seen timestamptz not null default now(),
  primary key (room_id, participant_id)
);

alter table public.room_participants enable row level security;

create policy "Anyone can read room participants"
  on public.room_participants for select using (true);

create policy "Anyone can add room participants"
  on public.room_participants for insert with check (true);

create policy "Anyone can update room participants"
  on public.room_participants for update using (true) with check (true);

create policy "Anyone can remove room participants"
  on public.room_participants for delete using (true);

alter table public.room_participants replica identity full;
alter publication supabase_realtime add table public.room_participants;