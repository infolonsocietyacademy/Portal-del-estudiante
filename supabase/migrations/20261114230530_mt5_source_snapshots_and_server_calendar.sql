-- Preserve original archives; use the complete native MT5 source once reconciled.
ALTER TABLE public.olon_mt_sync_state
 ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1 CHECK (source_version IN (1,2)),
 ADD COLUMN IF NOT EXISTS source_clock_mode text CHECK (source_clock_mode IN ('server','utc')),
 ADD COLUMN IF NOT EXISTS history_revision text CHECK (history_revision ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE VIEW public.olon_own_account_statistics WITH (security_invoker=true) AS
 WITH base AS (
         SELECT a.id AS account_id,
            a.student_id,
            d.id AS deal_id,
            d.deal_type,
            d.entry_type,
            d.occurred_at,
            d.comment AS balance_comment,
            COALESCE(NULLIF(d.broker_time, '')::timestamp, d.occurred_at AT TIME ZONE 'UTC') AS business_time,
            CASE WHEN a.broker_server ~* '^Axi-' THEN (now() AT TIME ZONE 'America/New_York') + interval '7 hours' ELSE now() AT TIME ZONE 'UTC' END AS server_now,
            COALESCE(d.profit, 0::numeric) AS profit,
            COALESCE(d.commission, 0::numeric) AS commission,
            COALESCE(d.swap, 0::numeric) AS swap,
            COALESCE(d.fee, 0::numeric) AS fee,
            COALESCE(d.profit, 0::numeric) + COALESCE(d.commission, 0::numeric) + COALESCE(d.swap, 0::numeric) + COALESCE(d.fee, 0::numeric) AS net,
            d.deal_type = ANY (ARRAY['DEAL_TYPE_BUY'::text, 'DEAL_TYPE_SELL'::text]) AS trade,
            d.entry_type = ANY (ARRAY['DEAL_ENTRY_OUT'::text, 'DEAL_ENTRY_OUT_BY'::text, 'DEAL_ENTRY_INOUT'::text]) AS closed
           FROM public.olon_own_accounts a
             LEFT JOIN public.olon_mt_sync_state s ON s.provider_account_id = a.provider_account_id
             LEFT JOIN public.olon_mt_deals d ON d.student_id = a.student_id AND
              CASE WHEN COALESCE(s.source_version, 1) >= 2 THEN d.provider_account_id = a.provider_account_id
                   ELSE (a.vault_account_id IS NOT NULL AND d.vault_account_id = a.vault_account_id OR a.vault_account_id IS NULL AND d.provider_account_id = a.provider_account_id) END
          WHERE a.status <> 'revoked'::text
        )
 SELECT account_id,
    student_id,
    count(deal_id) FILTER (WHERE trade AND closed) AS closed_trades,
    count(deal_id) FILTER (WHERE trade AND closed AND net > 0::numeric) AS wins,
    COALESCE(sum(net) FILTER (WHERE trade), 0::numeric) AS net_profit,
    COALESCE(sum(net) FILTER (WHERE trade AND date_trunc('month'::text, business_time) = date_trunc('month'::text, server_now)), 0::numeric) AS month_net,
    count(deal_id) AS total_deals,
    count(deal_id) FILTER (WHERE trade AND closed AND net < 0::numeric) AS losses,
    count(deal_id) FILTER (WHERE trade AND closed AND net = 0::numeric) AS breakeven_trades,
    COALESCE(sum(net) FILTER (WHERE trade AND business_time::date = server_now::date), 0::numeric) AS today_net,
    COALESCE(sum(net) FILTER (WHERE trade AND date_trunc('week'::text, business_time) = date_trunc('week'::text, server_now)), 0::numeric) AS week_net,
    COALESCE(sum(net) FILTER (WHERE trade AND closed AND net > 0::numeric), 0::numeric) AS gross_profit,
    COALESCE(sum(- net) FILTER (WHERE trade AND closed AND net < 0::numeric), 0::numeric) AS gross_loss,
    COALESCE(sum(profit) FILTER (WHERE deal_type = 'DEAL_TYPE_BALANCE'::text AND profit > 0::numeric AND (balance_comment ~~* 'DEP %'::text OR balance_comment ~~* 'DEPOSIT %'::text)), 0::numeric) AS deposits,
    COALESCE(sum(- profit) FILTER (WHERE deal_type = 'DEAL_TYPE_BALANCE'::text AND profit < 0::numeric AND (balance_comment ~~* 'WDL %'::text OR balance_comment ~~* 'WDR %'::text OR balance_comment ~~* 'WITHDRAWAL %'::text)), 0::numeric) AS withdrawals,
    COALESCE(sum(commission + swap + fee) FILTER (WHERE trade), 0::numeric) AS fees,
    max(occurred_at) FILTER (WHERE trade AND closed) AS last_closed_trade_at,
    COALESCE(sum(profit) FILTER (WHERE deal_type = 'DEAL_TYPE_BALANCE'::text AND profit > 0::numeric AND balance_comment ~~* 'Transfer from%'::text), 0::numeric) AS transfer_in,
    COALESCE(sum(- profit) FILTER (WHERE deal_type = 'DEAL_TYPE_BALANCE'::text AND profit < 0::numeric AND balance_comment ~~* 'Transfer to%'::text), 0::numeric) AS transfer_out,
    COALESCE(sum(profit) FILTER (WHERE deal_type = 'DEAL_TYPE_BALANCE'::text AND balance_comment !~~* 'DEP %'::text AND balance_comment !~~* 'DEPOSIT %'::text AND balance_comment !~~* 'WDL %'::text AND balance_comment !~~* 'WDR %'::text AND balance_comment !~~* 'WITHDRAWAL %'::text AND balance_comment !~~* 'Transfer from%'::text AND balance_comment !~~* 'Transfer to%'::text), 0::numeric) AS balance_adjustments
   FROM base
  GROUP BY account_id, student_id;

