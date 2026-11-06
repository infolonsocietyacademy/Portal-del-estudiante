#property version "1.00"
#property description "Sincroniza el historial de MetaTrader 5 con el portal de OLON. Solo lectura."

input string CodigoVinculacion = "";

const string Endpoint = "https://xanhhfashgkyrvphprts.supabase.co/functions/v1/mt5-sync";
const int DaySeconds = 86400;
const int BatchSize = 100;

string login, server, currency, stateFile, token;
datetime nextDay = 0;
bool pairPending = false;
bool tradesChanged = true;
datetime refreshAfter = 0, repairAfter = 0;
int lastStatus = 0;

string JsonString(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return "\"" + value + "\"";
}

bool IsHex(const string value, const int length)
{
   if(StringLen(value) != length)
      return false;
   for(int i = 0; i < length; i++)
   {
      ushort c = StringGetCharacter(value, i);
      if(!((c >= 48 && c <= 57) || (c >= 97 && c <= 102)))
         return false;
   }
   return true;
}

string AccountFields()
{
   return "\"login\":" + JsonString(login)
        + ",\"server\":" + JsonString(server)
        + ",\"currency\":" + JsonString(currency);
}

int Post(const string json, const string secret, string &body)
{
   char data[], result[];
   int bytes = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(bytes <= 0)
      return -1;
   ArrayResize(data, bytes - 1);
   string headers = "Content-Type: application/json\r\n";
   if(secret != "")
      headers += "Authorization: Bearer " + secret + "\r\n";

   string responseHeaders;
   ResetLastError();
   int status = WebRequest("POST", Endpoint, headers, 4000, data, result, responseHeaders);
   body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status != 200 && status != lastStatus)
   {
      if(status == -1)
         Print("OLON MT5: autoriza la URL en Herramientas > Opciones > Asesores Expertos. Error ", GetLastError());
      else
         Print("OLON MT5: respuesta ", status, ". Si la conexión fue revocada, genera otro código en el portal.");
   }
   lastStatus = status;
   return status;
}

void LoadState()
{
   int file = FileOpen(stateFile, FILE_READ | FILE_TXT | FILE_ANSI, 0, CP_UTF8);
   if(file == INVALID_HANDLE)
      return;
   string savedServer = FileReadString(file);
   string savedCurrency = FileReadString(file);
   string savedToken = FileReadString(file);
   datetime savedDay = (datetime)StringToInteger(FileReadString(file));
   FileClose(file);
   if(savedServer == server && savedCurrency == currency && IsHex(savedToken, 64))
   {
      token = savedToken;
      nextDay = savedDay;
   }
}

bool SaveState()
{
   int file = FileOpen(stateFile, FILE_WRITE | FILE_TXT | FILE_ANSI, 0, CP_UTF8);
   if(file == INVALID_HANDLE)
      return false;
   uint written = FileWriteString(file, server + "\r\n" + currency + "\r\n" + token + "\r\n"
                                      + IntegerToString((long)nextDay) + "\r\n");
   FileClose(file);
   return written > 0;
}

bool Pair()
{
   string code = CodigoVinculacion;
   StringTrimLeft(code);
   StringTrimRight(code);
   StringToLower(code);
   if(!IsHex(code, 32))
   {
      Print("OLON MT5: pega un código de vinculación válido generado en el portal.");
      pairPending = false;
      return false;
   }
   string body;
   int status = Post("{\"action\":\"pair\",\"code\":" + JsonString(code) + "," + AccountFields() + "}", "", body);
   if(status != 200)
   {
      if(status == 400 || status == 403)
         pairPending = false;
      return false;
   }

   int key = StringFind(body, "\"token\"");
   int colon = key < 0 ? -1 : StringFind(body, ":", key + 7);
   int quote = colon < 0 ? -1 : StringFind(body, "\"", colon + 1);
   string newToken = quote < 0 ? "" : StringSubstr(body, quote + 1, 64);
   if(!IsHex(newToken, 64))
      return false;

   token = newToken;
   nextDay = 0;
   pairPending = false;
   if(!SaveState())
      Print("OLON MT5: no se pudo guardar la conexión en MQL5/Files.");
   Print("OLON MT5: cuenta vinculada. Comenzando la sincronización.");
   return true;
}

bool DealJson(const ulong ticket, string &deal)
{
   deal = "";
   long rawType, executed, rawEntry;
   if(!HistoryDealGetInteger(ticket, DEAL_TYPE, rawType))
      return false;
   ENUM_DEAL_TYPE type = (ENUM_DEAL_TYPE)rawType;
   string kind;
   if(type == DEAL_TYPE_BUY)
      kind = "buy";
   else if(type == DEAL_TYPE_SELL)
      kind = "sell";
   else if(type == DEAL_TYPE_BUY_CANCELED || type == DEAL_TYPE_SELL_CANCELED)
      kind = "cancelled";
   else if(type == DEAL_TYPE_COMMISSION || type == DEAL_TYPE_COMMISSION_DAILY || type == DEAL_TYPE_COMMISSION_MONTHLY)
      kind = "commission";
   else
      return true;

   if(!HistoryDealGetInteger(ticket, DEAL_TIME, executed)
      || !HistoryDealGetInteger(ticket, DEAL_ENTRY, rawEntry))
      return false;
   string entry = "";
   if(kind != "commission")
   {
      switch((ENUM_DEAL_ENTRY)rawEntry)
      {
         case DEAL_ENTRY_IN: entry = "in"; break;
         case DEAL_ENTRY_OUT: entry = "out"; break;
         case DEAL_ENTRY_INOUT: entry = "inout"; break;
         case DEAL_ENTRY_OUT_BY: entry = "out_by"; break;
      }
   }

   string brokerTime = TimeToString((datetime)executed, TIME_DATE | TIME_SECONDS);
   StringReplace(brokerTime, ".", "-");
   StringReplace(brokerTime, " ", "T");
   string symbol;
   double profit, commission, swap, fee;
   if(!HistoryDealGetString(ticket, DEAL_SYMBOL, symbol)
      || !HistoryDealGetDouble(ticket, DEAL_PROFIT, profit)
      || !HistoryDealGetDouble(ticket, DEAL_COMMISSION, commission)
      || !HistoryDealGetDouble(ticket, DEAL_SWAP, swap)
      || !HistoryDealGetDouble(ticket, DEAL_FEE, fee))
      return false;

   deal = "{\"ticket\":" + JsonString(StringFormat("%I64u", ticket))
        + ",\"broker_time\":" + JsonString(brokerTime)
        + ",\"symbol\":" + JsonString(symbol)
        + ",\"kind\":" + JsonString(kind)
        + ",\"entry\":" + JsonString(entry)
        + ",\"profit\":" + DoubleToString(profit, 8)
        + ",\"commission\":" + DoubleToString(commission, 8)
        + ",\"swap\":" + DoubleToString(swap, 8)
        + ",\"fee\":" + DoubleToString(fee, 8) + "}";
   return true;
}

bool SendDeals(const string deals)
{
   string body;
   return Post("{\"action\":\"sync\"," + AccountFields() + ",\"deals\":[" + deals + "]}", token, body) == 200;
}

bool SyncDay(const datetime day, const datetime today)
{
   if(!HistorySelect(day, day + DaySeconds - 1))
      return false;

   const int total = HistoryDealsTotal();
   int count = 0;
   bool sent = false;
   string batch = "";
   for(int i = 0; i < total && !IsStopped(); i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      string deal;
      if(ticket == 0 || !DealJson(ticket, deal))
         return false;
      if(deal == "")
         continue;
      if(count > 0)
         batch += ",";
      batch += deal;
      count++;
      if(count == BatchSize)
      {
         if(!SendDeals(batch))
            return false;
         sent = true;
         count = 0;
         batch = "";
      }
   }
   if(IsStopped())
      return false;
   if(count > 0 || (day == today && !sent))
      return SendDeals(batch);
   return true;
}

int OnInit()
{
   login = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   server = AccountInfoString(ACCOUNT_SERVER);
   currency = AccountInfoString(ACCOUNT_CURRENCY);
   StringToUpper(currency);
   if(login == "0" || server == "" || currency == "")
      return INIT_FAILED;
   // Keep each login/server separate, and verify both before reusing a token.
   string safeServer = server;
   for(int i = 0; i < StringLen(safeServer); i++)
   {
      ushort c = StringGetCharacter(safeServer, i);
      if(!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)))
         StringSetCharacter(safeServer, i, 95);
   }
   stateFile = "OLON_MT5_" + login + "_" + safeServer + ".txt";
   LoadState();
   pairPending = (CodigoVinculacion != "");
   if(token == "" && !pairPending)
      Print("OLON MT5: genera tu código en el portal y pégalo en CodigoVinculacion.");
   return EventSetTimer(20) ? INIT_SUCCEEDED : INIT_FAILED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTradeTransaction(const MqlTradeTransaction &transaction, const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(transaction.type == TRADE_TRANSACTION_DEAL_ADD)
      tradesChanged = true;
   else if(transaction.type == TRADE_TRANSACTION_DEAL_UPDATE || transaction.type == TRADE_TRANSACTION_DEAL_DELETE)
      repairAfter = 0;
}

void OnTimer()
{
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)
      || login != IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      || server != AccountInfoString(ACCOUNT_SERVER))
      return;

   if(pairPending)
      Pair();
   if(token == "")
      return;

   datetime brokerNow = TimeTradeServer();
   if(brokerNow <= 0)
      return;
   datetime today = brokerNow - (brokerNow % DaySeconds);
   datetime now = TimeGMT();
   bool repair = now >= repairAfter;
   if(nextDay > today && !tradesChanged && !repair && now < refreshAfter)
      return;

   datetime recent = today - 2 * DaySeconds;
   datetime first = nextDay;
   if(first <= 0)
      first = today - 89 * DaySeconds;
   else if(repair && first > recent)
      first = recent;
   else if(first > today)
      first = today;
   datetime initialCheckpoint = nextDay;
   for(int i = 0; i < 7 && first <= today && !IsStopped(); i++, first += DaySeconds)
   {
      if(!SyncDay(first, today))
         break;
      if(first >= nextDay)
         nextDay = first + DaySeconds;
      if(first == today)
      {
         tradesChanged = false;
         refreshAfter = now + 300;
         if(repair)
            repairAfter = now + 1800;
      }
   }
   if(nextDay != initialCheckpoint && !SaveState())
      Print("OLON MT5: no se pudo guardar el progreso local.");
}
