-- 1) Add 'webchat' to team_type enum (used by brand_channels.type)
ALTER TYPE public.team_type ADD VALUE IF NOT EXISTS 'webchat';
