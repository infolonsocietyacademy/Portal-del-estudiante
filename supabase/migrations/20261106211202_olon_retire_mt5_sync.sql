revoke execute on function public.olon_mt5_service(text, jsonb, uuid) from service_role;
revoke select, insert, update, delete on
  private.olon_mt5_codes, private.olon_mt5_connections, private.olon_mt5_deals
  from service_role;
