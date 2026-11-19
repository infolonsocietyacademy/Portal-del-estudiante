// Shared, strict contract. No passwords or commands are accepted from the portal.
export function validateSettings(value) {
  const fail = message => { throw new Error(message); };
  const number = (v, min, max, label, integer=false) => {
    if(typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(label+' inválido');
    return v;
  };
  const text = (v, max, label) => {
    if(typeof v !== 'string' || !v.trim() || v.trim().length > max || /[\x00-\x1f]/.test(v)) fail(label+' inválido');
    return v.trim();
  };
  const paths=new Set(), identities=new Set(), ids=new Set();
  const account = a => {
    if(!a || typeof a !== 'object') fail('Completa la cuenta');
    const terminal_path=text(a.terminal_path,260,'Ruta MT5');
    if(!/^[A-Za-z]:\\[^<>|"?*]+\\terminal64\.exe$/i.test(terminal_path)) fail('Usa la ruta completa de terminal64.exe en Windows');
    const login=number(a.login,1,Number.MAX_SAFE_INTEGER,'Número de cuenta',true);
    const server=text(a.server,100,'Servidor');
    const p=terminal_path.toLowerCase(), identity=server.toLowerCase()+'|'+login;
    if(paths.has(p)||identities.has(identity)) fail('La maestra y cada receptora necesitan cuenta y terminal distintos');
    paths.add(p);identities.add(identity);
    return {terminal_path,login,server};
  };
  if(!value || value.version!==1) fail('Versión de configuración inválida');
  const master=account(value.master);
  if(!Array.isArray(value.followers)||value.followers.length<1||value.followers.length>20) fail('Agrega entre 1 y 20 cuentas receptoras');
  const followers=value.followers.map(f=>{
    const a=account(f), id=text(f.id,40,'Identificador');
    if(!/^[A-Za-z0-9_-]+$/.test(id)||ids.has(id)) fail('Identificador de receptora repetido o inválido');
    ids.add(id);
    if(typeof f.enabled!=='boolean') fail('Estado de receptora inválido');
    if(!f.symbols || typeof f.symbols!=='object'||Array.isArray(f.symbols)) fail('Completa el mapa de símbolos');
    const pairs=Object.entries(f.symbols);
    if(!pairs.length||pairs.length>30) fail('Configura de 1 a 30 símbolos');
    const symbols=Object.fromEntries(pairs.map(([k,v])=>{
      if(!/^[A-Za-z0-9_.#-]{1,48}$/.test(k)||typeof v!=='string'||!/^[A-Za-z0-9_.#-]{1,48}$/.test(v)) fail('Símbolo inválido');
      return [k,v];
    }));
    return {...a,id,enabled:f.enabled,symbols,
      lot_multiplier:number(f.lot_multiplier,0.001,100,'Multiplicador'),
      max_lots:number(f.max_lots,0.001,1000,'Máximo de lotes'),
      max_risk_pct:number(f.max_risk_pct,0.01,100,'Riesgo por entrada'),
      max_daily_loss_pct:number(f.max_daily_loss_pct,0.01,100,'Pérdida diaria'),
      max_positions:number(f.max_positions,1,100,'Máximo de posiciones',true),
      max_spread_points:number(f.max_spread_points,1,100000,'Spread máximo'),
      max_entry_drift_points:number(f.max_entry_drift_points,1,100000,'Desviación máxima')};
  });
  return {version:1,master,followers,poll_seconds:2,max_signal_age_seconds:5,max_snapshot_age_seconds:3,max_tick_age_seconds:5};
}
