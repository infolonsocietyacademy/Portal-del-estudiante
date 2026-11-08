/* OLON risk calculator: uses user-supplied monetary value per price unit and lot. No broker-specific assumptions. */
(function(){
'use strict';
function init(){
 const dashboard=document.getElementById('dashboard'); if(!dashboard||document.getElementById('olonRiskCalculator'))return;
 const intro=document.createElement('div');intro.className='olonTerminalIntro';intro.innerHTML='<div><h2>◈ TRADING TERMINAL PRO</h2><p>Rendimiento · Gestión de capital · Disciplina</p></div><span class="olonTerminalBadge">OLON SOCIETY ACADEMY</span>';
 const spotlight=dashboard.querySelector('.cyberDashboardSpotlight');if(spotlight)dashboard.insertBefore(intro,spotlight);
 const card=document.createElement('section');card.id='olonRiskCalculator';card.className='olonRiskCard';card.setAttribute('aria-label','Calculadora de riesgo');
 card.innerHTML='<h3>▣ Calculadora de Riesgo PRO</h3><p>Calcula el tamaño de posición antes de operar. Verifica el valor por punto con las especificaciones de tu bróker.</p><div class="olonRiskGrid"><label>Mercado<select id="orMarket"><option value="spot">Forex / Spot</option><option value="futures">Futuros</option><option value="indices">Índices / CFD</option></select></label><label>Instrumento<input id="orSymbol" value="XAUUSD" maxlength="24" autocomplete="off"></label><label>Capital (USD)<input id="orCapital" type="number" min="0.01" step="any" value="10000"></label><label>Riesgo (%)<input id="orPercent" type="number" min="0.01" max="100" step="any" value="1"></label><label>Distancia al Stop Loss (puntos de precio)<input id="orStop" type="number" min="0.000001" step="any" value="5"></label><label>Valor USD por 1 punto y 1 lote/contrato<input id="orPointValue" type="number" min="0.000001" step="any" value="100"></label><label>Incremento mínimo de lote/contrato<input id="orStep" type="number" min="0.000001" step="any" value="0.01"></label><label>Relación beneficio/riesgo<select id="orRR"><option value="1">1:1</option><option value="2" selected>1:2</option><option value="3">1:3</option><option value="4">1:4</option></select></label></div><div class="olonRiskResult" aria-live="polite"><div><small>Riesgo máximo</small><strong id="orRiskMoney">—</strong></div><div><small>Posición sugerida</small><strong id="orSize">—</strong></div><div><small>Beneficio potencial (RR)</small><strong id="orReward">—</strong></div></div><p id="orNotice" class="olonRiskNotice" role="status">Los cálculos son estimaciones y no incluyen spread, comisiones ni deslizamiento.</p>';
 if(spotlight)dashboard.insertBefore(card,spotlight.nextSibling);else dashboard.appendChild(card);
 const $=id=>card.querySelector('#'+id);
 const fields=['orCapital','orPercent','orStop','orPointValue','orStep','orRR'];
 function calculate(){
  const [capital,percent,stop,point,step,rr]=fields.map(id=>Number($(id).value));
  if(![capital,percent,stop,point,step,rr].every(Number.isFinite)||capital<=0||percent<=0||percent>100||stop<=0||point<=0||step<=0||rr<=0){$('orRiskMoney').textContent='—';$('orSize').textContent='—';$('orReward').textContent='—';$('orNotice').textContent='Introduce valores positivos y un riesgo entre 0.01% y 100%.';return;}
  const budget=capital*percent/100, raw=budget/(stop*point), units=Math.floor((raw/step)+1e-9),size=units*step, actual=size*stop*point;
  const money=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
  $('orRiskMoney').textContent=money(budget);$('orSize').textContent=size>0?Number(size.toFixed(8)).toLocaleString('en-US',{maximumFractionDigits:8})+' '+($('orMarket').value==='futures'?'contratos':'lotes'):'No viable';
  $('orReward').textContent=money(actual*rr);
  $('orNotice').textContent=size>0?'Riesgo estimado real: '+money(actual)+'. No incluye spread, comisiones ni deslizamiento. Confirma el valor por punto y tamaño mínimo con tu bróker.':'El capital no alcanza para el tamaño mínimo seleccionado con ese stop loss.';
 }
 fields.forEach(id=>$(id).addEventListener('input',calculate));$('orMarket').addEventListener('change',calculate);calculate();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();