REVOKE ALL ON FUNCTION public.baran_owner_wallet_gateway(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baran_owner_wallet_gateway(uuid,text,jsonb) TO service_role;
