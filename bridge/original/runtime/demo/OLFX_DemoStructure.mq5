#property strict
#property version "1.00"
#property description "DEMO ONLY: EURUSD M1 confirmed swing continuation. Max 3 attempts / 30 minutes."
input ulong ExpectedDemoLogin=0;
input string ExpectedDemoServer="";
input ulong TaskMagic=0;
input string ResultFile="";
input string TradeLogStem="";
const double DEMO_VOLUME=0.01;
const int MAX_ATTEMPTS=3, SESSION_SECONDS=1800, HOLD_SECONDS=300;
uint last_retcode=0;
int attempts=0;
bool draining=false, finished=false, outstanding=false;
ulong started_ms=0, position_ms=0;
datetime session_time=0, last_bar=0;
string reason="WAIT_NEW_M1_CLOSE";
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


// Both pivots are confirmed BEFORE bar 2. Bar 1 is the newest closed candle.
int TrendBreak(double hn,double ho,double ln,double lo,double previous,double close,double open)
{
   if(hn>ho && ln>lo && previous<=hn && close>hn && close>open) return 1;
   if(hn<ho && ln<lo && previous>=ln && close<ln && close<open) return -1;
   return 0;
}

int StructureSignal(const MqlRates &rates[],double &stop_level,double &break_level)
{
   int count=ArraySize(rates); if(count<64) return 0;
   double highs[2]={0,0},lows[2]={0,0}; int nh=0,nl=0;
   for(int i=5;i<count-2;i++)
   {
      bool high=true,low=true;
      for(int k=1;k<=2;k++)
      {
         if(rates[i].high<=rates[i-k].high || rates[i].high<=rates[i+k].high) high=false;
         if(rates[i].low>=rates[i-k].low || rates[i].low>=rates[i+k].low) low=false;
      }
      if(high && nh<2) { highs[nh]=rates[i].high; nh++; }
      if(low && nl<2) { lows[nl]=rates[i].low; nl++; }
      if(nh==2 && nl==2) break;
   }
   if(nh<2 || nl<2) return 0;
   int side=TrendBreak(highs[0],highs[1],lows[0],lows[1],rates[2].close,rates[1].close,rates[1].open);
   stop_level=side>0?lows[0]:highs[0]; break_level=side>0?highs[0]:lows[0];
   return side;
}

bool EntryWindow(int used,int seconds,bool position,bool waiting,bool stopping)
{
   return used<MAX_ATTEMPTS && seconds<SESSION_SECONDS && !position && !waiting && !stopping;
}

int Elapsed()
{
   if(MQLInfoInteger(MQL_TESTER)) return (int)(TimeCurrent()-session_time);
   return (int)((GetTickCount64()-started_ms)/1000);
}

bool SymbolBusy()
{
   for(int i=0;i<PositionsTotal();i++)
      if(PositionGetTicket(i)>0 && PositionGetString(POSITION_SYMBOL)==_Symbol) return true;
   for(int i=0;i<OrdersTotal();i++)
      if(OrderGetTicket(i)>0 && OrderGetString(ORDER_SYMBOL)==_Symbol) return true;
   return false;
}

bool HaveCompletedExecution()
{
   if(!HistorySelect(session_time-60,TimeCurrent()+60)) return false;
   datetime last_in=0,last_out=0;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong deal=HistoryDealGetTicket(i);
      if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=TaskMagic || HistoryDealGetString(deal,DEAL_SYMBOL)!=_Symbol) continue;
      long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
      datetime stamp=(datetime)HistoryDealGetInteger(deal,DEAL_TIME);
      if(entry==DEAL_ENTRY_IN && stamp>last_in) last_in=stamp;
      if((entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) && stamp>last_out) last_out=stamp;
   }
   return last_in>0 && last_out>=last_in && OwnPosition()==0;
}

void WriteSession(string code)
{
   int ins=0,outs=0; double net=0;
   bool verified=CorrectDemo();
   if(verified && HistorySelect(session_time-60,TimeCurrent()+60))
      for(int i=0;i<HistoryDealsTotal();i++)
      {
         ulong deal=HistoryDealGetTicket(i);
         if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=TaskMagic || HistoryDealGetString(deal,DEAL_SYMBOL)!=_Symbol) continue;
         long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
         if(entry==DEAL_ENTRY_IN) ins++;
         if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) outs++;
         net+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_COMMISSION)
            +HistoryDealGetDouble(deal,DEAL_SWAP)+HistoryDealGetDouble(deal,DEAL_FEE);
      }
   int h=FileOpen(ResultFile,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(h!=INVALID_HANDLE)
   {
      string text="{\"schema\":1,\"code\":\""+code+"\",\"demo_verified\":"+(verified?"true":"false")
         +",\"open_attempts\":"+(string)attempts+",\"entry_deals\":"+(string)ins+",\"exit_deals\":"+(string)outs
         +",\"open_positions\":"+(OwnPosition()>0?"1":"0")+",\"elapsed_seconds\":"+(string)Elapsed()
         +",\"last_retcode\":"+(string)last_retcode+",\"net_recorded\":"+DoubleToString(net,2)+"}";
      FileWriteString(h,text); FileFlush(h); FileClose(h);
   }
   Comment("OLFX DEMO - ESTRUCTURA EURUSD M1\n",reason,"\nIntentos ",attempts," / 3; ejecuciones ",ins,
      "; cierres ",outs,"\nSesion ",Elapsed()," / 1800 s | Neto ",DoubleToString(net,2),
      "\n0.01 lote | SL estructural | TP 1:2 | Max 1 posicion");
}

bool CloseStructure()
{
   if(!CanSend()) return false;
   ulong ticket=OwnPosition(); if(ticket==0 || !PositionSelectByTicket(ticket)) return false;
   double volume=PositionGetDouble(POSITION_VOLUME);
   if(volume<=0 || volume>DEMO_VOLUME+0.0000001) return false;
   long side=PositionGetInteger(POSITION_TYPE);
   MqlTick tick={}; if(!SymbolInfoTick(_Symbol,tick)) return false;
   MqlTradeRequest req={}; MqlTradeResult res={};
   req.action=TRADE_ACTION_DEAL; req.symbol=_Symbol; req.magic=TaskMagic; req.position=ticket; req.volume=volume;
   req.type=side==POSITION_TYPE_BUY?ORDER_TYPE_SELL:ORDER_TYPE_BUY;
   req.price=side==POSITION_TYPE_BUY?tick.bid:tick.ask; req.deviation=20; req.type_filling=FillMode();
   req.comment="OLFX M1 DEMO CLOSE";
   if(!CorrectDemo()) return false;
   bool ok=OrderSend(req,res); last_retcode=res.retcode;
   return ok && (res.retcode==TRADE_RETCODE_DONE || res.retcode==TRADE_RETCODE_DONE_PARTIAL);
}

bool OpenStructure(int side,double swing,double level,double candle_close,datetime signal_bar)
{
   if(!CanSend() || SymbolBusy() || !EntryWindow(attempts,Elapsed(),false,outstanding,draining)) return false;
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT),step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double pip=point*((_Digits==3 || _Digits==5)?10:1),ticksize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(step<=0 || ticksize<=0 || SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)>DEMO_VOLUME+0.0000001
      || SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX)<DEMO_VOLUME
      || MathAbs(DEMO_VOLUME/step-MathRound(DEMO_VOLUME/step))>0.000001) return false;
   MqlTick tick={}; if(!SymbolInfoTick(_Symbol,tick) || tick.bid<=0 || tick.ask<=tick.bid) return false;
   if(tick.ask-tick.bid>2*pip) { reason="SPREAD_OVER_2_PIPS"; return false; }
   if(MathAbs(TimeCurrent()-tick.time)>10 || MathAbs((double)(TimeCurrent()-signal_bar-60))>10) return false;
   double entry=side>0?tick.ask:tick.bid;
   if(MathAbs(entry-candle_close)>2*pip || (side>0 && entry<=level) || (side<0 && entry>=level)) return false;
   double minimum=MathMax(5*pip,SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*point+tick.ask-tick.bid+2*point);
   double risk=side>0?entry-(swing-pip):(swing+pip)-entry;
   risk=MathMax(risk,minimum); if(risk>30*pip) { reason="STOP_OVER_30_PIPS"; return false; }
   double sl=NormalizeDouble((side>0?MathFloor((entry-risk)/ticksize):MathCeil((entry+risk)/ticksize))*ticksize,_Digits);
   risk=MathAbs(entry-sl); if(risk>30*pip+point) return false;
   double tp=NormalizeDouble(MathRound((entry+side*2*risk)/ticksize)*ticksize,_Digits);
   MqlTradeRequest req={}; MqlTradeResult res={}; MqlTradeCheckResult check={};
   req.action=TRADE_ACTION_DEAL; req.symbol=_Symbol; req.magic=TaskMagic; req.volume=DEMO_VOLUME;
   req.type=side>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL; req.price=entry; req.sl=sl; req.tp=tp;
   req.deviation=20; req.type_filling=FillMode(); req.comment="OLFX M1 BOS DEMO";
   if(!CorrectDemo() || !OrderCheck(req,check)) { reason="ORDER_CHECK_BLOCKED"; return false; }
   string marker=ResultFile+".entry_"+(string)(attempts+1);
   if(FileIsExist(marker)) { draining=true; reason="PERSISTED_ATTEMPT_BLOCKED"; return false; }
   int h=FileOpen(marker,FILE_WRITE|FILE_TXT|FILE_ANSI); if(h==INVALID_HANDLE) { draining=true; return false; }
   FileWriteString(h,(string)signal_bar); FileFlush(h); FileClose(h);
   attempts++; outstanding=true; WriteSession("SESSION_RUNNING");
   if(!CorrectDemo()) { draining=true; return false; }
   bool ok=OrderSend(req,res); last_retcode=res.retcode;
   if(!ok || (res.retcode!=TRADE_RETCODE_DONE && res.retcode!=TRADE_RETCODE_DONE_PARTIAL && res.retcode!=TRADE_RETCODE_PLACED))
   {
      // An uncertain response cannot authorize a second entry.
      draining=true; reason="ENTRY_NOT_CONFIRMED_NO_RETRY"; return false;
   }
   position_ms=GetTickCount64(); reason=side>0?"BOS_BUY_WITH_SL_TP":"BOS_SELL_WITH_SL_TP";
   Print(reason," | SL=",sl," TP=",tp," volume=0.01");
   return true;
}

int OnInit()
{
   if(MQLInfoInteger(MQL_TESTER) || ExpectedDemoLogin==0 || TaskMagic==0 || _Symbol!="EURUSD" || _Period!=PERIOD_M1) return INIT_FAILED;
   if(StringFind(ResultFile,"OLFX_M1_")!=0 || StringFind(ResultFile,"\\")>=0 || StringFind(ResultFile,"/")>=0
      || StringFind(ResultFile,":")>=0 || StringFind(TradeLogStem,"OLFX_TRADES_")!=0
      || StringFind(TradeLogStem,"\\")>=0 || StringFind(TradeLogStem,"/")>=0 || StringFind(TradeLogStem,":")>=0) return INIT_FAILED;
   started_ms=GetTickCount64(); session_time=TimeCurrent(); last_bar=iTime(_Symbol,PERIOD_M1,1);
   for(int n=1;n<=MAX_ATTEMPTS;n++) if(FileIsExist(ResultFile+".entry_"+(string)n)) attempts=n;
   if(FileIsExist(ResultFile+".attempted")) { draining=true; reason="RESTART_CLOSE_ONLY_NO_NEW_ENTRIES"; }
   else
   {
      int h=FileOpen(ResultFile+".attempted",FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(h==INVALID_HANDLE) return INIT_FAILED;
      FileWriteString(h,"session_started"); FileFlush(h); FileClose(h);
   }
   ChartSetInteger(0,CHART_SHOW_TRADE_LEVELS,true);
   EventSetTimer(1); return INIT_SUCCEEDED;
}

void ProcessSession()
{
   SavePositionSnapshot();
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) return;
   if(!CorrectDemo()) { draining=true; reason="DEMO_ACCOUNT_GUARD_BLOCKED"; WriteSession("DEMO_ACCOUNT_GUARD_BLOCKED"); return; }
   if(FileIsExist(ResultFile+".cancel") || Elapsed()>=SESSION_SECONDS || attempts>=MAX_ATTEMPTS) draining=true;
   ulong ticket=OwnPosition();
   if(ticket>0 && PositionSelectByTicket(ticket))
   {
      outstanding=true;
      int held=(int)(TimeCurrent()-(datetime)PositionGetInteger(POSITION_TIME));
      if(FileIsExist(ResultFile+".cancel") || Elapsed()>=SESSION_SECONDS || held>=HOLD_SECONDS)
      { reason="CLOSING_OWN_DEMO_POSITION"; CloseStructure(); }
      WriteSession(draining?"SESSION_DRAINING":"SESSION_RUNNING"); return;
   }
   if(outstanding && HaveCompletedExecution()) outstanding=false;
   if(draining)
   {
      bool pending=OwnPendingOrder();
      reason=outstanding?"CLOSE_STATE_PENDING_CHECK_DEMO":"SESSION_FINISHED_NO_NEW_ENTRIES";
      if(!pending && (!outstanding || HaveCompletedExecution())) { finished=true; outstanding=false; WriteSession("SESSION_FINISHED"); }
      else WriteSession("SESSION_CLOSE_PENDING");
      return;
   }
   WriteSession("SESSION_RUNNING");
   MqlRates rates[]; ArraySetAsSeries(rates,true);
   if(CopyRates(_Symbol,PERIOD_M1,0,96,rates)<64) { reason="WAITING_M1_HISTORY"; return; }
   if(last_bar==0) { last_bar=rates[1].time; return; }
   if(rates[1].time==last_bar) return;
   last_bar=rates[1].time;
   if(!EntryWindow(attempts,Elapsed(),SymbolBusy(),outstanding,draining)) return;
   double stop=0,level=0; int side=StructureSignal(rates,stop,level);
   reason=side==0?"WAIT_CONFIRMED_HH_HL_OR_LH_LL_BREAK":"SIGNAL_CHECKING_EXECUTION";
   if(side!=0) OpenStructure(side,stop,level,rates[1].close,rates[1].time);
}

void OnTimer() { ProcessSession(); }
void OnTick() { if(MQLInfoInteger(MQL_TESTER)) ProcessSession(); }
void OnDeinit(const int reason_code)
{
   EventKillTimer(); draining=true;
   if(OwnPosition()>0) CloseStructure();
}

