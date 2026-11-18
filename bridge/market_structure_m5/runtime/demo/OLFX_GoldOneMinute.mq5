#property strict
#property version "1.00"
#property description "DEMO ONLY: XAUUSD DEMO only. One explicit buy, close request after 60 seconds."
input ulong ExpectedDemoLogin=0;
input string ExpectedDemoServer="";
input ulong TaskMagic=0;
input string ResultFile="";
input string TradeLogStem="";
input string ExpectedGoldSymbol="";
input int SizeMode=0;
input double FixedLots=0.01;
input double RiskPercent=0.5;
input double MaxSpreadPrice=0.60;
input double MaxStopPrice=20.0;
const double MAX_GOLD_LOTS=1.0;
double last_volume=0,planned_risk_cash=0;
const int MAX_ATTEMPTS=1, SESSION_SECONDS=180, HOLD_SECONDS=60;
uint last_retcode=0;
int attempts=0;
bool draining=false, finished=false, outstanding=false;
ulong started_ms=0, position_ms=0;
datetime session_time=0, last_bar=0;
string reason="WAIT_NEW_M1_CLOSE";
bool GoldIdentity()
{
   return StringFind(ExpectedGoldSymbol,"XAUUSD")==0 && _Symbol==ExpectedGoldSymbol && _Period==PERIOD_M1
      && SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE)=="XAU"
      && SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT)=="USD";
}

bool CorrectDemo()
{
   return !MQLInfoInteger(MQL_TESTER)
      && TerminalInfoInteger(TERMINAL_CONNECTED)
      && AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO
      && (ulong)AccountInfoInteger(ACCOUNT_LOGIN)==ExpectedDemoLogin
      && AccountInfoString(ACCOUNT_SERVER)==ExpectedDemoServer
      && ExpectedDemoLogin>0 && TaskMagic>0 && GoldIdentity();
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
   int ins=0,outs=0; double net=0,entry_volume=0,exit_volume=0,entry_value=0,exit_value=0; datetime first_entry=0,last_exit=0;
   bool verified=CorrectDemo();
   if(verified && HistorySelect(session_time-60,TimeCurrent()+60))
      for(int i=0;i<HistoryDealsTotal();i++)
      {
         ulong deal=HistoryDealGetTicket(i);
         if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=TaskMagic || HistoryDealGetString(deal,DEAL_SYMBOL)!=_Symbol) continue;
         long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
         if(entry==DEAL_ENTRY_IN)
         { ins++; double v=HistoryDealGetDouble(deal,DEAL_VOLUME);entry_volume+=v;entry_value+=v*HistoryDealGetDouble(deal,DEAL_PRICE); datetime t=(datetime)HistoryDealGetInteger(deal,DEAL_TIME); if(first_entry==0 || t<first_entry) first_entry=t; }
         if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY)
         { outs++; double v=HistoryDealGetDouble(deal,DEAL_VOLUME);exit_volume+=v;exit_value+=v*HistoryDealGetDouble(deal,DEAL_PRICE); datetime t=(datetime)HistoryDealGetInteger(deal,DEAL_TIME); if(t>last_exit) last_exit=t; }
         net+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_COMMISSION)
            +HistoryDealGetDouble(deal,DEAL_SWAP)+HistoryDealGetDouble(deal,DEAL_FEE);
      }
   int h=FileOpen(ResultFile,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(h!=INVALID_HANDLE)
   {
      string text="{\"schema\":1,\"code\":\""+code+"\",\"demo_verified\":"+(verified?"true":"false")
         +",\"open_attempts\":"+(string)attempts+",\"entry_deals\":"+(string)ins+",\"exit_deals\":"+(string)outs
         +",\"open_positions\":"+(OwnPosition()>0?"1":"0")+",\"elapsed_seconds\":"+(string)Elapsed()
         +",\"last_retcode\":"+(string)last_retcode+",\"net_recorded\":"+DoubleToString(net,2)
         +",\"symbol\":\""+JsonText(_Symbol)+"\",\"size_mode\":"+(string)SizeMode
         +",\"fixed_lots\":"+DoubleToString(FixedLots,8)+",\"risk_percent\":"+DoubleToString(RiskPercent,8)
         +",\"volume_executed\":"+DoubleToString(entry_volume,8)+",\"volume_closed\":"+DoubleToString(exit_volume,8)
         +",\"open_price\":"+DoubleToString(entry_volume>0?entry_value/entry_volume:0,8)
         +",\"close_price\":"+DoubleToString(exit_volume>0?exit_value/exit_volume:0,8)
         +",\"held_seconds\":"+(string)(first_entry>0 && last_exit>=first_entry?(int)(last_exit-first_entry):0)
         +",\"last_volume\":"+DoubleToString(last_volume,8)+",\"planned_risk_cash\":"+DoubleToString(planned_risk_cash,2)+"}";
      FileWriteString(h,text); FileFlush(h); FileClose(h);
   }
   Comment("OLFX DEMO - COMPRA DE DEMOSTRACION ",_Symbol," M1\n",reason,"\nIntentos ",attempts," / 1; ejecuciones ",ins,
      "; cierres ",outs,"\nSesion ",Elapsed()," / 180 s | Neto ",DoubleToString(net,2),
      "\nLote ultimo: ",DoubleToString(last_volume,3)," | Riesgo SL estimado: ",DoubleToString(planned_risk_cash,2),"\nUNA compra DEMO | Cierre solicitado tras 60 segundos | SL/TP en broker");
}

bool CloseStructure()
{
   if(!CanSend()) return false;
   ulong ticket=OwnPosition(); if(ticket==0 || !PositionSelectByTicket(ticket)) return false;
   double volume=PositionGetDouble(POSITION_VOLUME);
   if(volume<=0 || volume>MAX_GOLD_LOTS+0.0000001) return false;
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


// Pure sizing math. Percent mode never rounds up to the broker minimum.
double SizeForBudget(int mode,double fixed,double budget,double loss_per_lot,double minimum,double maximum,double step)
{
   if(!MathIsValidNumber(minimum) || !MathIsValidNumber(maximum) || !MathIsValidNumber(step)
      || minimum<=0 || maximum<minimum || step<=0 || !MathIsValidNumber(loss_per_lot) || loss_per_lot<=0) return 0;
   double cap=MathMin(maximum,MAX_GOLD_LOTS);
   if(mode==0)
   {
      if(!MathIsValidNumber(fixed) || fixed<minimum-1e-10 || fixed>cap+1e-10
         || MathAbs(fixed/step-MathRound(fixed/step))>1e-7) return 0;
      return NormalizeDouble(fixed,8);
   }
   if(mode!=1 || !MathIsValidNumber(budget) || budget<=0) return 0;
   double raw=MathMin(budget/loss_per_lot,cap);
   double lots=NormalizeDouble(MathFloor((raw+1e-10)/step)*step,8);
   if(lots<minimum-1e-10 || lots>cap+1e-10 || lots*loss_per_lot>budget+1e-7) return 0;
   return lots;
}

double ClosedATR(const MqlRates &rates[])
{
   if(ArraySize(rates)<16) return 0;
   double total=0;
   for(int i=1;i<=14;i++)
      total+=MathMax(rates[i].high-rates[i].low,MathMax(MathAbs(rates[i].high-rates[i+1].close),MathAbs(rates[i].low-rates[i+1].close)));
   return total/14;
}

bool OpenDemonstration(double atr)
{
   if(!CanSend() || SymbolBusy() || !EntryWindow(attempts,Elapsed(),false,outstanding,draining)) return false;
   int side=1;
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT),ticksize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(!MathIsValidNumber(atr) || !MathIsValidNumber(point) || !MathIsValidNumber(ticksize) || atr<=0 || point<=0 || ticksize<=0) return false;
   MqlTick tick={}; if(!SymbolInfoTick(_Symbol,tick) || tick.bid<=0 || tick.ask<=tick.bid) return false;
   if(tick.ask-tick.bid>MaxSpreadPrice) { reason="GOLD_SPREAD_FILTER"; return false; }
   if(MathAbs(TimeCurrent()-tick.time)>10) return false;
   double entry=side>0?tick.ask:tick.bid;
   double broker_gap=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*point+tick.ask-tick.bid+2*point;
   double minimum=MathMax(atr,broker_gap),buffer=MathMax(0.2*atr,2*ticksize);
   double risk=2*atr;
   risk=MathMax(risk,minimum);
   double cap=MathMin(4*atr,MaxStopPrice);
   if(risk>cap) { reason="GOLD_STOP_EXCEEDS_FILTER"; return false; }
   double sl=NormalizeDouble((side>0?MathFloor((entry-risk)/ticksize):MathCeil((entry+risk)/ticksize))*ticksize,_Digits);
   risk=MathAbs(entry-sl); if(risk>cap+point) return false;
   double tp=NormalizeDouble(MathRound((entry+side*2*risk)/ticksize)*ticksize,_Digits);
   double reference=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),loss=0;
   ENUM_ORDER_TYPE type=side>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(reference<=0 || !OrderCalcProfit(type,_Symbol,reference,entry,sl,loss) || loss>=0) { reason="GOLD_PROFIT_CALC_UNAVAILABLE"; return false; }
   double per_lot=MathAbs(loss)/reference;
   double budget=AccountInfoDouble(ACCOUNT_EQUITY)*RiskPercent/100.0;
   double volume=SizeForBudget(SizeMode,FixedLots,budget,per_lot,reference,
      SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP));
   if(volume<=0) { reason="GOLD_VOLUME_BELOW_MIN_OR_INVALID"; return false; }
   MqlTradeRequest req={}; MqlTradeResult res={}; MqlTradeCheckResult check={};
   req.action=TRADE_ACTION_DEAL; req.symbol=_Symbol; req.magic=TaskMagic; req.volume=volume;
   req.type=type; req.price=entry; req.sl=sl; req.tp=tp;
   req.deviation=20; req.type_filling=FillMode(); req.comment="OLFX GOLD DEMO";
   if(!CorrectDemo() || !OrderCheck(req,check)) { reason="GOLD_ORDER_CHECK_BLOCKED"; return false; }
   string marker=ResultFile+".entry_"+(string)(attempts+1);
   if(FileIsExist(marker)) { draining=true; reason="PERSISTED_ATTEMPT_BLOCKED"; return false; }
   int h=FileOpen(marker,FILE_WRITE|FILE_TXT|FILE_ANSI); if(h==INVALID_HANDLE) { draining=true; return false; }
   FileWriteString(h,"one_minute_demonstration"); FileFlush(h); FileClose(h);
   attempts++; outstanding=true; last_volume=volume; planned_risk_cash=per_lot*volume; WriteSession("SESSION_RUNNING");
   if(!CorrectDemo()) { draining=true; return false; }
   bool ok=OrderSend(req,res); last_retcode=res.retcode;
   if(!ok || (res.retcode!=TRADE_RETCODE_DONE && res.retcode!=TRADE_RETCODE_DONE_PARTIAL && res.retcode!=TRADE_RETCODE_PLACED))
   { draining=true; reason="ENTRY_NOT_CONFIRMED_NO_RETRY"; return false; }
   position_ms=GetTickCount64(); reason=side>0?"GOLD_DEMONSTRATION_BUY_WITH_SL_TP":"GOLD_DEMONSTRATION_SELL_WITH_SL_TP";
   Print(reason," | SL=",sl," TP=",tp," volume=",volume," planned_risk=",planned_risk_cash);
   return true;
}

int OnInit()
{
   if(MQLInfoInteger(MQL_TESTER) || ExpectedDemoLogin==0 || TaskMagic==0 || !GoldIdentity()) return INIT_FAILED;
   if((SizeMode!=0 && SizeMode!=1) || !MathIsValidNumber(FixedLots) || FixedLots<=0 || FixedLots>MAX_GOLD_LOTS
      || !MathIsValidNumber(RiskPercent) || RiskPercent<0.05 || RiskPercent>2.0
      || !MathIsValidNumber(MaxSpreadPrice) || MaxSpreadPrice<0.01 || MaxSpreadPrice>5.0
      || !MathIsValidNumber(MaxStopPrice) || MaxStopPrice<0.1 || MaxStopPrice>50.0) return INIT_FAILED;
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
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   { if(Elapsed()>=60 && attempts==0) { draining=true; WriteSession("DEMO_CONNECTION_UNAVAILABLE"); } return; }
   if(!CorrectDemo()) { draining=true; WriteSession("DEMO_ACCOUNT_GUARD_BLOCKED"); return; }
   if(FileIsExist(ResultFile+".cancel") || Elapsed()>=SESSION_SECONDS || attempts>=MAX_ATTEMPTS) draining=true;
   ulong ticket=OwnPosition();
   if(ticket>0 && PositionSelectByTicket(ticket))
   {
      outstanding=true;
      int held=(int)(TimeCurrent()-(datetime)PositionGetInteger(POSITION_TIME));
      if(FileIsExist(ResultFile+".cancel") || Elapsed()>=SESSION_SECONDS || held>=HOLD_SECONDS)
      { reason="CLOSING_ONE_MINUTE_DEMO"; CloseStructure(); }
      else reason="DEMO_BUY_OPEN_AUTO_CLOSE_60_SECONDS";
      WriteSession("SESSION_DRAINING"); return;
   }
   if(outstanding && HaveCompletedExecution()) outstanding=false;
   if(draining)
   {
      bool pending=OwnPendingOrder();
      if(!pending && !outstanding) { finished=true; reason="ONE_MINUTE_DEMO_FINISHED"; WriteSession("SESSION_FINISHED"); }
      else WriteSession("SESSION_CLOSE_PENDING");
      return;
   }
   reason="DEMO_PREVIEW_20_SECONDS"; WriteSession("SESSION_RUNNING");
   if(Elapsed()<20) return;
   if(!CanSend()) { draining=true; WriteSession("DEMO_TRADING_PERMISSION_BLOCKED"); return; }
   MqlRates rates[]; ArraySetAsSeries(rates,true);
   if(CopyRates(_Symbol,PERIOD_M1,0,96,rates)<16)
   { if(Elapsed()>=60) { draining=true; WriteSession("DEMO_HISTORY_UNAVAILABLE"); } return; }
   bool sent=OpenDemonstration(ClosedATR(rates));
   if(!sent && attempts>0) { draining=true; WriteSession("DEMO_OPEN_NOT_CONFIRMED"); }
}

void OnTimer() { ProcessSession(); }
void OnTick() { if(MQLInfoInteger(MQL_TESTER)) ProcessSession(); }
void OnDeinit(const int reason_code)
{
   EventKillTimer(); draining=true;
   if(OwnPosition()>0) CloseStructure();
}

