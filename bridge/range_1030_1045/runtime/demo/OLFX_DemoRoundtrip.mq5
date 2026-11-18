#property strict
#property version "1.00"
#property description "DEMO ACCOUNT ONLY. One EURUSD 0.01 buy, automatic close. Refuses real/contest/tester accounts."

input ulong ExpectedDemoLogin=0;
input string ExpectedDemoServer="";
input ulong TaskMagic=0;
input string ResultFile="";
input string TradeLogStem="";

const double DEMO_VOLUME=0.01;
const int PREVIEW_SECONDS=20;
const int HOLD_SECONDS=15;
ulong started_ms=0, opened_ms=0, sent_ms=0;
bool attempted=false, opened=false, closed=false, finished=false, close_ack=false, profit_known=false;
double open_price=0.0, close_price=0.0, profit=0.0;
uint last_retcode=0;
datetime started_time=0;

bool CorrectDemo()
{
   return !MQLInfoInteger(MQL_TESTER)
      && TerminalInfoInteger(TERMINAL_CONNECTED)
      && AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO
      && (ulong)AccountInfoInteger(ACCOUNT_LOGIN)==ExpectedDemoLogin
      && AccountInfoString(ACCOUNT_SERVER)==ExpectedDemoServer
      && ExpectedDemoLogin>0 && TaskMagic>0 && _Symbol=="EURUSD";
}

bool CanSend()
{
   return CorrectDemo() && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
      && MQLInfoInteger(MQL_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)
      && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
}

string JsonText(string value)
{
   StringReplace(value,"\\","\\\\"); StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r"," "); StringReplace(value,"\n"," ");
   return value;
}

void SavePositionSnapshot()
{
   if(TradeLogStem=="") return;
   bool verified=CorrectDemo();
   string rows=""; double floating=0.0;
   if(verified)
      for(int i=0;i<PositionsTotal();i++)
      {
         ulong ticket=PositionGetTicket(i); if(ticket==0) continue;
         if(rows!="") rows+=",";
         double value=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
         floating+=value;
         rows+="{\"position_id\":\""+(string)PositionGetInteger(POSITION_IDENTIFIER)+"\",\"symbol\":\""
            +JsonText(PositionGetString(POSITION_SYMBOL))+"\",\"side\":\""
            +(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?"BUY":"SELL")
            +"\",\"volume\":"+DoubleToString(PositionGetDouble(POSITION_VOLUME),8)
            +",\"open_price\":"+DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN),8)
            +",\"floating_profit\":"+DoubleToString(value,2)+"}";
      }
   int handle=FileOpen(TradeLogStem+".snapshot.json",FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(handle==INVALID_HANDLE) return;
   FileWriteString(handle,"{\"schema\":1,\"demo_verified\":"+(verified?"true":"false")
      +",\"positions\":["+rows+"],\"floating_profit\":"+DoubleToString(floating,2)+"}");
   FileFlush(handle); FileClose(handle);
}

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result)
{
   if(!CorrectDemo() || TradeLogStem=="" || trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   long type=HistoryDealGetInteger(trans.deal,DEAL_TYPE);
   if(type!=DEAL_TYPE_BUY && type!=DEAL_TYPE_SELL) return;
   long entry=HistoryDealGetInteger(trans.deal,DEAL_ENTRY);
   string event=entry==DEAL_ENTRY_IN?"APERTURA":entry==DEAL_ENTRY_INOUT?"REVERSA":"CIERRE";
   string deal_side=type==DEAL_TYPE_BUY?"BUY":"SELL";
   string side=entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY?(type==DEAL_TYPE_BUY?"SELL":"BUY"):deal_side;
   string symbol=HistoryDealGetString(trans.deal,DEAL_SYMBOL);
   string stamp=TimeToString((datetime)HistoryDealGetInteger(trans.deal,DEAL_TIME),TIME_DATE|TIME_SECONDS);
   string position=(string)HistoryDealGetInteger(trans.deal,DEAL_POSITION_ID);
   double volume=HistoryDealGetDouble(trans.deal,DEAL_VOLUME),price=HistoryDealGetDouble(trans.deal,DEAL_PRICE);
   double pnl=HistoryDealGetDouble(trans.deal,DEAL_PROFIT),commission=HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
   double swap=HistoryDealGetDouble(trans.deal,DEAL_SWAP),fee=HistoryDealGetDouble(trans.deal,DEAL_FEE);
   double net=pnl+commission+swap+fee;
   string row="{\"deal_id\":\""+(string)trans.deal+"\",\"position_id\":\""+position
      +"\",\"time_server\":\""+stamp+"\",\"event\":\""+event+"\",\"symbol\":\""+JsonText(symbol)
      +"\",\"side\":\""+side+"\",\"deal_side\":\""+deal_side+"\",\"volume\":"+DoubleToString(volume,8)
      +",\"price\":"+DoubleToString(price,8)+",\"profit\":"+DoubleToString(pnl,2)
      +",\"commission\":"+DoubleToString(commission,2)+",\"swap\":"+DoubleToString(swap,2)
      +",\"fee\":"+DoubleToString(fee,2)+",\"net\":"+DoubleToString(net,2)+"}";
   int log=FileOpen(TradeLogStem+".jsonl",FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(log!=INVALID_HANDLE) { FileSeek(log,0,SEEK_END); FileWriteString(log,row+"\r\n"); FileFlush(log); FileClose(log); }
   int csv=FileOpen(TradeLogStem+".csv",FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,';',CP_UTF8);
   if(csv!=INVALID_HANDLE)
   {
      if(FileSize(csv)==0) FileWrite(csv,"hora_servidor","evento","activo","direccion","lado_deal","lote","precio","ganancia_perdida","comision","swap","fee","neto","deal_id","position_id");
      FileSeek(csv,0,SEEK_END);
      FileWrite(csv,stamp,event,symbol,side,deal_side,DoubleToString(volume,8),DoubleToString(price,8),
         DoubleToString(pnl,2),DoubleToString(commission,2),DoubleToString(swap,2),DoubleToString(fee,2),
         DoubleToString(net,2),(string)trans.deal,position);
      FileFlush(csv); FileClose(csv);
   }
   SavePositionSnapshot();
}

bool SaveState(string code)
{
   int handle=FileOpen(ResultFile,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(handle==INVALID_HANDLE) return false;
   string text="{\"schema\":1,\"code\":\""+code+"\",\"demo_verified\":"+(CorrectDemo()?"true":"false")
      +",\"opened\":"+(opened?"true":"false")+",\"closed\":"+(closed?"true":"false")
      +",\"retcode\":"+(string)last_retcode+",\"volume\":0.01,\"open_price\":"+DoubleToString(open_price,8)
      +",\"close_price\":"+DoubleToString(close_price,8)+",\"profit_known\":"+(profit_known?"true":"false")
      +",\"profit\":"+DoubleToString(profit,2)+"}";
   FileWriteString(handle,text);
   FileFlush(handle);
   FileClose(handle);
   return true;
}

ENUM_ORDER_TYPE_FILLING FillMode()
{
   long flags=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   if((flags&SYMBOL_FILLING_FOK)==SYMBOL_FILLING_FOK) return ORDER_FILLING_FOK;
   if((flags&SYMBOL_FILLING_IOC)==SYMBOL_FILLING_IOC) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

ulong OwnPosition()
{
   if(!CorrectDemo()) return 0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0 && PositionGetString(POSITION_SYMBOL)==_Symbol
         && (ulong)PositionGetInteger(POSITION_MAGIC)==TaskMagic) return ticket;
   }
   return 0;
}

bool OwnPendingOrder()
{
   if(!CorrectDemo()) return false;
   bool pending=false;
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong ticket=OrderGetTicket(i);
      if(ticket>0 && OrderGetString(ORDER_SYMBOL)==_Symbol
         && (ulong)OrderGetInteger(ORDER_MAGIC)==TaskMagic)
      {
         pending=true;
         if(CanSend())
         {
            MqlTradeRequest request={}; MqlTradeResult result={};
            request.action=TRADE_ACTION_REMOVE; request.order=ticket;
            if(CorrectDemo()) { bool ok=OrderSend(request,result); last_retcode=result.retcode; }
         }
      }
   }
   return pending;
}

bool OpenDemo()
{
   if(!CanSend()) return false;
   // Avoid merging with an existing EURUSD position on a netting account.
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong existing=PositionGetTicket(i);
      if(existing>0 && PositionGetString(POSITION_SYMBOL)==_Symbol) return false;
   }
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong existing=OrderGetTicket(i);
      if(existing>0 && OrderGetString(ORDER_SYMBOL)==_Symbol) return false;
   }
   double minimum=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maximum=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(minimum>DEMO_VOLUME+0.0000001 || maximum<DEMO_VOLUME || step<=0
      || MathAbs(DEMO_VOLUME/step-MathRound(DEMO_VOLUME/step))>0.000001) return false;
   MqlTick tick={};
   if(!SymbolInfoTick(_Symbol,tick) || tick.ask<=0 || tick.bid<=0) return false;
   MqlTradeRequest request={}; MqlTradeResult result={};
   request.action=TRADE_ACTION_DEAL; request.symbol=_Symbol; request.magic=TaskMagic;
   request.volume=DEMO_VOLUME; request.type=ORDER_TYPE_BUY; request.price=tick.ask;
   request.deviation=20; request.type_filling=FillMode(); request.comment="OLFX DEMO ONLY";
   if(!CorrectDemo()) return false;
   bool ok=OrderSend(request,result); last_retcode=result.retcode;
   return ok && (result.retcode==TRADE_RETCODE_DONE || result.retcode==TRADE_RETCODE_DONE_PARTIAL || result.retcode==TRADE_RETCODE_PLACED);
}

bool CloseDemo()
{
   if(!CanSend()) return false;
   ulong ticket=OwnPosition();
   if(ticket==0 || !PositionSelectByTicket(ticket)) return false;
   if(PositionGetInteger(POSITION_TYPE)!=POSITION_TYPE_BUY) return false;
   if(PositionGetDouble(POSITION_VOLUME)>DEMO_VOLUME+0.0000001) return false;
   MqlTick tick={}; if(!SymbolInfoTick(_Symbol,tick) || tick.bid<=0) return false;
   MqlTradeRequest request={}; MqlTradeResult result={};
   request.action=TRADE_ACTION_DEAL; request.symbol=_Symbol; request.magic=TaskMagic;
   request.position=ticket; request.volume=PositionGetDouble(POSITION_VOLUME);
   request.type=ORDER_TYPE_SELL; request.price=tick.bid; request.deviation=20;
   request.type_filling=FillMode(); request.comment="OLFX DEMO CLOSE";
   // Check account identity and demo status immediately before every send.
   if(!CorrectDemo()) return false;
   bool ok=OrderSend(request,result); last_retcode=result.retcode;
   if(ok && (result.retcode==TRADE_RETCODE_DONE || result.retcode==TRADE_RETCODE_DONE_PARTIAL))
   { close_ack=true; close_price=result.price; return true; }
   return false;
}

void CompleteClose(string code)
{
   if(!CorrectDemo() || OwnPosition()>0) return;
   closed=true; profit=0.0; profit_known=false;
   if(HistorySelect(started_time-120,TimeCurrent()+60))
      for(int i=0;i<HistoryDealsTotal();i++)
      {
         ulong deal=HistoryDealGetTicket(i);
         if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)==TaskMagic && HistoryDealGetString(deal,DEAL_SYMBOL)==_Symbol)
         {
            profit+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_COMMISSION)
               +HistoryDealGetDouble(deal,DEAL_SWAP)+HistoryDealGetDouble(deal,DEAL_FEE);
            long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
            if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_INOUT)
            { close_price=HistoryDealGetDouble(deal,DEAL_PRICE); profit_known=true; }
         }
      }
   ObjectCreate(0,"OLFX_DEMO_CLOSE_"+(string)TaskMagic,OBJ_ARROW_SELL,0,TimeCurrent(),close_price);
   Finish(code);
}

void Finish(string code)
{
   SaveState(code); finished=true;
   Comment("OLFX DEMO EURUSD 0.01\n",code,"\nApertura: ",DoubleToString(open_price,_Digits),
      "\nCierre: ",DoubleToString(close_price,_Digits),"\nResultado DEMO: ",DoubleToString(profit,2));
   ChartRedraw();
}

int OnInit()
{
   if(MQLInfoInteger(MQL_TESTER) || ExpectedDemoLogin==0 || TaskMagic==0
      || StringFind(ResultFile,"OLFX_DEMO_")!=0 || StringFind(ResultFile,"\\")>=0
      || StringFind(ResultFile,"/")>=0 || _Symbol!="EURUSD") return INIT_FAILED;
   if(StringFind(TradeLogStem,"OLFX_TRADES_")!=0 || StringFind(TradeLogStem,"\\")>=0
      || StringFind(TradeLogStem,"/")>=0 || StringFind(TradeLogStem,":")>=0) return INIT_FAILED;
   started_ms=GetTickCount64(); started_time=TimeCurrent();
   // Persist the open attempt before sending. Reattaching cannot create another order.
   attempted=FileIsExist(ResultFile+".attempted");
   if(attempted) sent_ms=started_ms;
   ChartSetInteger(0,CHART_SHOW_TRADE_LEVELS,true);
   EventSetTimer(1); Comment("OLFX DEMO: verificando cuenta...");
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   SavePositionSnapshot();
   if(finished) return;
   ulong elapsed=(GetTickCount64()-started_ms)/1000;
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      if(elapsed>=60 && !attempted) Finish("DEMO_CONNECTION_UNAVAILABLE");
      return;
   }
   if(!CorrectDemo()) { Finish("DEMO_ACCOUNT_GUARD_BLOCKED"); return; }
   ulong ticket=OwnPosition();
   if(ticket>0 && PositionSelectByTicket(ticket))
   {
      if(!opened)
      {
         opened=true; opened_ms=GetTickCount64();
         started_time=(datetime)PositionGetInteger(POSITION_TIME);
         open_price=PositionGetDouble(POSITION_PRICE_OPEN); SaveState("DEMO_OPENED");
         ObjectCreate(0,"OLFX_DEMO_BUY_"+(string)TaskMagic,OBJ_ARROW_BUY,0,TimeCurrent(),open_price);
      }
      int remaining=HOLD_SECONDS-(int)((GetTickCount64()-opened_ms)/1000);
      Comment("OLFX DEMO - BUY 0.01 EURUSD ABIERTA\nCierre automatico en ",MathMax(remaining,0)," segundos");
      if(remaining<=0 || FileIsExist(ResultFile+".cancel"))
      {
         bool close_ok=CloseDemo();
         if(close_ok && CorrectDemo() && OwnPosition()==0)
         {
            CompleteClose("DEMO_ROUNDTRIP_CLOSED");
         }
         else if((GetTickCount64()-opened_ms)/1000>60) SaveState("DEMO_CLOSE_PENDING");
      }
      ChartRedraw(); return;
   }
   if(opened) { CompleteClose(close_ack?"DEMO_ROUNDTRIP_CLOSED":"DEMO_POSITION_NO_LONGER_OPEN"); return; }
   if(attempted)
   {
      if(GetTickCount64()-sent_ms>20000)
      {
         if(!OwnPendingOrder()) Finish("DEMO_OPEN_NOT_CONFIRMED");
      }
      return;
   }
   if(FileIsExist(ResultFile+".cancel")) { Finish("DEMO_CANCELLED_BEFORE_OPEN"); return; }
   Comment("OLFX DEMO - EURUSD 0.01\nApertura de demostracion en ",MathMax(PREVIEW_SECONDS-(int)elapsed,0)," segundos");
   if(elapsed<PREVIEW_SECONDS) return;
   if(!CanSend()) { Finish("DEMO_TRADING_PERMISSION_BLOCKED"); return; }
   int marker=FileOpen(ResultFile+".attempted",FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(marker==INVALID_HANDLE) { Finish("DEMO_STATE_FILE_UNAVAILABLE"); return; }
   FileWriteString(marker,"attempted"); FileClose(marker);
   attempted=true; sent_ms=GetTickCount64();
   if(!SaveState("DEMO_OPEN_REQUESTED")) { Finish("DEMO_STATE_FILE_UNAVAILABLE"); return; }
   OpenDemo();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(!closed && OwnPosition()>0) CloseDemo();
}

