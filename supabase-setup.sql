-- DiaGuide — Supabase 一次性設定
-- 用法：Supabase Dashboard → SQL Editor → New query → 貼上全部 → Run

-- 每位使用者一列，整包 app 狀態存成 JSONB
create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 開啟 Row Level Security：每人只能存取自己那列
alter table public.app_state enable row level security;

-- 既有 policy 先移除（重跑此腳本時不報錯）
drop policy if exists "own row select" on public.app_state;
drop policy if exists "own row insert" on public.app_state;
drop policy if exists "own row update" on public.app_state;

create policy "own row select" on public.app_state
  for select using (auth.uid() = user_id);

create policy "own row insert" on public.app_state
  for insert with check (auth.uid() = user_id);

create policy "own row update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
