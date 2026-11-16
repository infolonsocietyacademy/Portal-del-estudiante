#property strict
#property version "1.00"
#property description "OLFX bridge diagnostic only. No trading rules or orders."

int OnInit()
{
   // Refuse execution on any chart outside the Strategy Tester.
   if(!MQLInfoInteger(MQL_TESTER))
      return(INIT_FAILED);
   return(INIT_SUCCEEDED);
}

void OnTick() {}

double OnTester()
{
   return TesterStatistics(STAT_TRADES);
}
