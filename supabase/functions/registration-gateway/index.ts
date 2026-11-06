import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const URL_BASE=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PUBLIC=Deno.env.get("SUPABASE_ANON_KEY")||"";
const HEAD={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{...HEAD,"Cache-Control":"no-store"}});
const svc=()=>({Authorization:"Bearer "+SERVICE,apikey:SERVICE,"Content-Type":"application/json"});
const db=async(path:string,init:RequestInit={})=>{
 const res=await fetch(URL_BASE+"/rest/v1/"+path,{...init,headers:{...svc(),...init.headers}});
 const data=res.status===204?null:await res.json().catch(()=>null);
 if(!res.ok)throw Object.assign(new Error(String(data?.message||data?.msg||"Error de base de datos")),{status:res.status,code:data?.code});
 return data;
};
const goodEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254;
const hex=async(v:string)=>{
 const result=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
 return Array.from(new Uint8Array(result)).map(c=>c.toString(16).padStart(2,"0")).join("");
};
async function whoIsAdmin(req:Request){
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token)return null;
 const auth=await fetch(URL_BASE+"/auth/v1/user",{headers:{Authorization:"Bearer "+token,apikey:PUBLIC}});
 if(!auth.ok)return null;
 const user=await auth.json().catch(()=>null);
 if(!user?.id)return null;
 const rows=await db("profiles?id=eq."+encodeURIComponent(user.id)+"&select=id,role,status");
 const p=rows?.[0];
 return p?.role==="admin"&&p?.status==="active"?user:null;
}
function temporaryPassword(){
 const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
 const bytes=crypto.getRandomValues(new Uint8Array(24));
 return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("");
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEAD});
 if(req.method!=="POST")return respond({error:"Método no permitido"},405);
 if(!URL_BASE||!SERVICE||!PUBLIC)return respond({error:"El servicio de inscripción no está configurado."},503);
 let body:any;try{body=await req.json();}catch{return respond({error:"Solicitud incorrecta."},400)}
 const action=String(body?.action||"");
 try{
  if(action==="apply"){
   const full_name=String(body?.name||"").trim().replace(/\s+/g," ");
   const email=String(body?.email||"").trim().toLowerCase();
   if(full_name.length<2||full_name.length>120||!goodEmail(email))return respond({error:"Completa un nombre y correo electrónico válidos."},400);
   // Honey-pot + fingerprint prevent basic automated floods without persisting plaintext IP.
   if(body?.website)return respond({ok:true,message:"Solicitud recibida."});
   const remote=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim();
   const ipHash=await hex(remote+"|"+SERVICE.slice(0,32));
   const fifteen=new Date(Date.now()-15*60_000).toISOString();
   const recent=await db("access_requests?ip_hash=eq."+ipHash+"&created_at=gte."+encodeURIComponent(fifteen)+"&select=id&limit=6");
   if(recent.length>=5)return respond({error:"Demasiadas solicitudes recientes. Intenta más tarde."},429);
   const duplicate=await db("access_requests?email=eq."+encodeURIComponent(email)+"&status=eq.pending&select=id&limit=1");
   if(duplicate.length)return respond({ok:true,message:"Si ya enviaste una solicitud, permanece pendiente de revisión."});
   const exists=await db("profiles?email=eq."+encodeURIComponent(email)+"&select=id&limit=1");
   if(exists.length)return respond({ok:true,message:"Si tu correo ya tiene una cuenta, inicia sesión o recupera tu contraseña."});
   try{
    await db("access_requests",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify([{full_name,email,ip_hash:ipHash}])});
   }catch(e){if((e as any).code==="23505")return respond({ok:true,message:"La solicitud ya fue recibida."});throw e}
   return respond({ok:true,message:"Solicitud enviada. Un administrador debe revisar tu acceso. Aún no se ha creado tu cuenta de inicio de sesión."});
  }
  const admin=await whoIsAdmin(req);
  if(!admin)return respond({error:"Acceso exclusivo del administrador."},403);
  if(action==="list"){
   const requests=await db("access_requests?select=id,full_name,email,status,created_at,processed_at&order=created_at.desc&limit=300");
   return respond({requests});
  }
  if(action==="reject"){
   const id=String(body.id||"");
   if(!/^[a-f0-9-]{36}$/i.test(id))return respond({error:"Solicitud inválida."},400);
   await db("access_requests?id=eq."+encodeURIComponent(id)+"&status=eq.pending",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"rejected",processed_at:new Date().toISOString()})});
   return respond({ok:true});
  }
  if(action==="approve"){
   const id=String(body.id||"");
   const plan=["VIP Regular","VIP Premium"].includes(body.plan)?body.plan:"VIP Regular";
   if(!/^[a-f0-9-]{36}$/i.test(id))return respond({error:"Solicitud inválida."},400);
   const rows=await db("access_requests?id=eq."+encodeURIComponent(id)+"&status=eq.pending&select=id,full_name,email");
   const reqRow=rows?.[0];
   if(!reqRow)return respond({error:"Solicitud no encontrada o ya procesada."},404);
   const existing=await db("profiles?email=eq."+encodeURIComponent(reqRow.email)+"&select=id,role,status&limit=1");
   if(existing.length)return respond({error:"Ya existe una cuenta con ese correo. No se creará una cuenta duplicada; revisa Authentication > Users."},409);
   const password=temporaryPassword();
   const result=await fetch(URL_BASE+"/auth/v1/admin/users",{method:"POST",headers:svc(),body:JSON.stringify({
     email:reqRow.email,password,email_confirm:true,user_metadata:{full_name:reqRow.full_name}
   })});
   const created=await result.json().catch(()=>({}));
   // GoTrue versions may return a User directly or wrapped as { user: User }.
   const newId=String(created?.user?.id||created?.id||"");
   if(!result.ok||!/^[a-f0-9-]{36}$/i.test(newId)){
    return respond({error:"No se pudo crear la cuenta: "+String(created.msg||created.message||created.error||result.status).slice(0,180)},409);
   }
   try{
    const updated=await db("profiles?id=eq."+encodeURIComponent(newId)+"&role=eq.student",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"active",plan})});
    if(!updated?.length)throw Error("No se encontró el perfil automático.");
   }catch(e){
    // Leave the Auth user pending rather than claiming account activation.
    return respond({error:"Se creó el usuario de Auth pero no se activó su perfil. Revisa el panel de Supabase antes de reintentar."},503);
   }
   await db("access_requests?id=eq."+encodeURIComponent(id)+"&status=eq.pending",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"processed",processed_at:new Date().toISOString()})});
   return respond({ok:true,email:reqRow.email,name:reqRow.full_name,password,plan,message:"Cuenta creada y activada. Comparte la contraseña temporal únicamente por un canal privado."});
  }
  return respond({error:"Acción no permitida"},400);
 }catch(e){console.error("olon registration error",String((e as any)?.message||e));return respond({error:"No se pudo completar la operación. Revisa la conexión e inténtalo de nuevo."},503)}
});