#property strict
#property version "1.00"
#property description "Diagnostic tester-only EA: one minimum-volume simulated round trip."

bool attempted=false;
datetime entered_at=0;
const ulong PROBE_MAGIC=26011601;

int OnInit()
{
   if(!MQLInfoInteger(MQL_TESTER))
      return INIT_FAILED;
   return INIT_SUCCEEDED;
}

ENUM_ORDER_TYPE_FILLING FillingMode()
{
   long flags=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   if((flags & SYMBOL_FILLING_FOK)==SYMBOL_FILLING_FOK)
      return ORDER_FILLING_FOK;
   if((flags & SYMBOL_FILLING_IOC)==SYMBOL_FILLING_IOC)
      return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

bool SendProbeDeal(bool closing)
{
   // Guard every send as well as initialization. Never operate on a normal chart.
   if(!MQLInfoInteger(MQL_TESTER))
      return false;
   MqlTick tick={};
   if(!SymbolInfoTick(_Symbol,tick) || tick.ask<=0 || tick.bid<=0)
      return false;
   MqlTradeRequest request={};
   MqlTradeResult result={};
   request.action=TRADE_ACTION_DEAL;
   request.symbol=_Symbol;
   request.magic=PROBE_MAGIC;
   request.deviation=20;
   request.type_filling=FillingMode();
   request.comment="OLFX tester diagnostic";
   if(closing)
   {
      if(!PositionSelect(_Symbol) || (ulong)PositionGetInteger(POSITION_MAGIC)!=PROBE_MAGIC)
         return false;
      request.position=(ulong)PositionGetInteger(POSITION_TICKET);
      request.volume=PositionGetDouble(POSITION_VOLUME);
      request.type=ORDER_TYPE_SELL;
      request.price=tick.bid;
   }
   else
   {
      request.volume=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
      request.type=ORDER_TYPE_BUY;
      request.price=tick.ask;
   }
   if(request.volume<=0)
      return false;
   bool sent=OrderSend(request,result);
   PrintFormat("OLFX_DIAGNOSTIC closing=%d sent=%d retcode=%u",closing,sent,result.retcode);
   return sent && (result.retcode==TRADE_RETCODE_DONE || result.retcode==TRADE_RETCODE_DONE_PARTIAL);
}

void OnTick()
{
   if(!MQLInfoInteger(MQL_TESTER))
      return;
   if(!attempted)
   {
      MqlTick tick={};
      if(!SymbolInfoTick(_Symbol,tick) || tick.ask<=0 || tick.bid<=0)
         return;
      attempted=true;
      if(SendProbeDeal(false))
         entered_at=TimeCurrent();
      return;
   }
   if(entered_at>0 && TimeCurrent()-entered_at>=60 && PositionSelect(_Symbol))
      SendProbeDeal(true);
}

double OnTester()
{
   return TesterStatistics(STAT_TRADES);
}
