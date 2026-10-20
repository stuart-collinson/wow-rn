-- 4) delete_my_account — the in-app deletion button; the cascade removes every user-owned row
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM auth.users WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

