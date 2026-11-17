#property version "1.00"
#property description "OLFX | Tres velas H4 cerradas"

input bool MostrarHighH4 = true;
input bool MostrarLowH4 = true;
input bool SoloPivotesConfirmados = false;
input bool ExtenderLineas = true;
input color ColorNiveles = clrBlack;
input bool AvisarToques = false;
input bool PublicarAlBridge = true;

const string Prefix = "OLFX_Liquidez_H4_";
MqlRates ClosedH4[4];
datetime LatestH4 = 0;
datetime LastChartBar = 0;
ulong LastPublishAttempt = 0;
string SnapshotFile = "";
bool Touched[3][3];

bool PivotHigh(const int index)
{
   if(index == 3)
      return false;
   return ClosedH4[index].high > ClosedH4[index + 1].high &&
          ClosedH4[index].high > ClosedH4[index - 1].high;
}

bool PivotLow(const int index)
{
   if(index == 3)
      return false;
   return ClosedH4[index].low < ClosedH4[index + 1].low &&
          ClosedH4[index].low < ClosedH4[index - 1].low;
}

bool CanPublishSymbol()
{
   for(int i = 0; i < StringLen(_Symbol); ++i)
   {
      ushort c = StringGetCharacter(_Symbol, i);
      if((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
         (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_')
         continue;
      return false;
   }
   return StringLen(_Symbol) > 0;
}

double Midpoint(const int index)
{
   return (ClosedH4[index].high + ClosedH4[index].low) / 2.0;
}

void PublishLevels()
{
   if(SnapshotFile == "")
      return;
   ulong now = GetTickCount64();
   if(LastPublishAttempt != 0 && now - LastPublishAttempt < 30000)
      return;
   LastPublishAttempt = now;

   string temporary = SnapshotFile + "." + IntegerToString(ChartID()) + ".tmp";
   int file = FileOpen(temporary, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(file == INVALID_HANDLE)
      return;

   bool written = true;
   for(int index = 3; index >= 1; --index)
   {
      uint bytes = FileWrite(file, 1, _Symbol, (long)ClosedH4[index].time,
                            DoubleToString(ClosedH4[index].high, _Digits),
                            DoubleToString(ClosedH4[index].low, _Digits),
                            DoubleToString(Midpoint(index), _Digits + 1),
                            (int)PivotHigh(index), (int)PivotLow(index));
      if(bytes == 0)
         written = false;
   }
   FileClose(file);
   if(!written || !FileMove(temporary, 0, SnapshotFile, FILE_REWRITE))
      FileDelete(temporary);
}

void SetLevel(const string name, const bool visible, const datetime origin,
              const datetime chart_bar, const double price, const string text,
              const ENUM_LINE_STYLE style, const bool extend_right)
{
   string trend = Prefix + name;
   string label = trend + "_label";
   if(!visible)
   {
      ObjectDelete(0, trend);
      ObjectDelete(0, label);
      return;
   }

   datetime end = chart_bar > origin ? chart_bar : origin + 1;
   if(ObjectFind(0, trend) < 0)
      ObjectCreate(0, trend, OBJ_TREND, 0, origin, price, end, price);
   else
   {
      ObjectMove(0, trend, 0, origin, price);
      ObjectMove(0, trend, 1, end, price);
   }
   ObjectSetInteger(0, trend, OBJPROP_RAY_RIGHT, extend_right);
   ObjectSetInteger(0, trend, OBJPROP_RAY_LEFT, false);
   ObjectSetInteger(0, trend, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, trend, OBJPROP_STYLE, style);
   ObjectSetInteger(0, trend, OBJPROP_COLOR, ColorNiveles);
   ObjectSetInteger(0, trend, OBJPROP_SELECTABLE, false);

   if(ObjectFind(0, label) < 0)
      ObjectCreate(0, label, OBJ_TEXT, 0, chart_bar, price);
   else
      ObjectMove(0, label, 0, chart_bar, price);
   ObjectSetString(0, label, OBJPROP_TEXT, text);
   ObjectSetInteger(0, label, OBJPROP_COLOR, ColorNiveles);
   ObjectSetInteger(0, label, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, label, OBJPROP_ANCHOR, ANCHOR_LEFT);
   ObjectSetInteger(0, label, OBJPROP_SELECTABLE, false);
}

bool HighVisible(const int index)
{
   return MostrarHighH4 && (!SoloPivotesConfirmados || PivotHigh(index));
}

bool LowVisible(const int index)
{
   return MostrarLowH4 && (!SoloPivotesConfirmados || PivotLow(index));
}

void DrawLevels(const datetime chart_bar)
{
   for(int index = 3; index >= 1; --index)
   {
      string slot = IntegerToString(index);
      datetime origin = ClosedH4[index].time;
      bool high = HighVisible(index);
      bool low = LowVisible(index);
      SetLevel(slot + "_high", high, origin, chart_bar, ClosedH4[index].high,
               "$$$ Liquidez HIGH", STYLE_SOLID, ExtenderLineas);
      SetLevel(slot + "_low", low, origin, chart_bar, ClosedH4[index].low,
               "$$$ Liquidez LOW", STYLE_SOLID, ExtenderLineas);
      SetLevel(slot + "_mid", high || low, origin, chart_bar, Midpoint(index),
               "50%", STYLE_DASH, false);
   }
   ChartRedraw();
}

void CheckTouch(const int slot, const int side, const double last, const double current,
                const double level, const string label)
{
   if(Touched[slot][side] || MathMin(last, current) > level || MathMax(last, current) < level)
      return;
   Touched[slot][side] = true;
   Alert("OLFX ", _Symbol, " H4 ", label, " tocado: ", DoubleToString(level, _Digits + 1));
}

void CheckTouches(const bool new_h4)
{
   if(!AvisarToques || MQLInfoInteger(MQL_TESTER))
      return;
   static double previous = 0.0;
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.bid <= 0.0)
      return;
   double last = previous;
   previous = tick.bid;
   if(new_h4 || last <= 0.0 || last == tick.bid)
      return;
   for(int index = 3; index >= 1; --index)
   {
      bool high = HighVisible(index);
      bool low = LowVisible(index);
      if(high)
         CheckTouch(index - 1, 0, last, tick.bid, ClosedH4[index].high, "HIGH");
      if(low)
         CheckTouch(index - 1, 1, last, tick.bid, ClosedH4[index].low, "LOW");
      if(high || low)
         CheckTouch(index - 1, 2, last, tick.bid, Midpoint(index), "50%");
   }
}

void RefreshLevels()
{
   datetime latest = iTime(_Symbol, PERIOD_H4, 1);
   datetime chart_bar = iTime(_Symbol, _Period, 0);
   if(latest <= 0 || chart_bar <= 0)
      return;
   bool new_h4 = latest != LatestH4;
   if(new_h4)
   {
      // Shift 1 skips the open bar. CopyRates places the oldest bar first.
      MqlRates rates[4];
      if(CopyRates(_Symbol, PERIOD_H4, 1, 4, rates) != 4 || rates[3].time != latest)
         return;
      bool retained[3][3];
      for(int index = 1; index <= 3; ++index)
      {
         for(int side = 0; side < 3; ++side)
         {
            retained[index - 1][side] = false;
            for(int old_index = 1; old_index <= 3; ++old_index)
               if(rates[index].time == ClosedH4[old_index].time)
                  retained[index - 1][side] = Touched[old_index - 1][side];
         }
      }
      for(int i = 0; i < 4; ++i)
         ClosedH4[i] = rates[i];
      for(int i = 0; i < 3; ++i)
         for(int side = 0; side < 3; ++side)
            Touched[i][side] = retained[i][side];

      LatestH4 = latest;
      LastPublishAttempt = 0;
   }
   if(new_h4 || chart_bar != LastChartBar)
   {
      DrawLevels(chart_bar);
      LastChartBar = chart_bar;
   }
   PublishLevels();
   CheckTouches(new_h4);
}

int OnInit()
{
   if(PeriodSeconds(_Period) > PeriodSeconds(PERIOD_H4))
   {
      Print("OLFX Liquidez H4: usa una temporalidad de H4 o inferior.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(PublicarAlBridge && !MQLInfoInteger(MQL_TESTER) && CanPublishSymbol())
      SnapshotFile = Prefix + _Symbol + ".csv";
   if(!EventSetTimer(1))
      return INIT_FAILED;
   RefreshLevels();
   return INIT_SUCCEEDED;
}

void OnTick()
{
   RefreshLevels();
}

void OnTimer()
{
   RefreshLevels();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, Prefix);
}
