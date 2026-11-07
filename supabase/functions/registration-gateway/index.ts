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
const goodId=(v:string)=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
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

async function removeStudentFiles(id:string){
 for(let batch=0;batch<20;batch++){
  const files:Array<{bucket_id:string;name:string}>=await db("rpc/olon_student_storage_batch",{
   method:"POST",body:JSON.stringify({p_student:id})
  });
  if(!files.length)return true;
  const buckets=new Map<string,string[]>();
  for(const file of files){
   if(!buckets.has(file.bucket_id))buckets.set(file.bucket_id,[]);
   buckets.get(file.bucket_id)!.push(file.name);
  }
  for(const [bucket,paths] of buckets){
   const response=await fetch(URL_BASE+"/storage/v1/object/"+encodeURIComponent(bucket),{
    method:"DELETE",headers:svc(),body:JSON.stringify({prefixes:paths})
   });
   if(!response.ok)return false;
  }
 }
 return false;
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
  if(action==="reset_student_password"||action==="delete_student"){
   const id=String(body.id||"").toLowerCase();
   if(!goodId(id)||id===admin.id)return respond({error:"Selecciona una cuenta de estudiante válida."},400);
   const profilePath="profiles?id=eq."+encodeURIComponent(id);
   const students=await db(profilePath+"&select=id,email,role,status");
   const student=students?.[0];
   if(student && student.role!=="student")return respond({error:"La cuenta seleccionada está protegida."},403);
   const authPath=URL_BASE+"/auth/v1/admin/users/"+encodeURIComponent(id);

   if(action==="reset_student_password"){
    if(!student)return respond({error:"La cuenta ya no está en el portal."},404);
    if(student.status==="deleting")return respond({error:"La cuenta está pendiente de eliminación."},409);
    const password=body.password;
    if(typeof password!=="string"||!password.trim()||Array.from(password).length<12||
       new TextEncoder().encode(password).length>72){
     return respond({error:"Usa al menos 12 caracteres y un máximo de 72 bytes."},400);
    }
    const result=await fetch(authPath,{method:"PUT",headers:svc(),body:JSON.stringify({password})});
    if(!result.ok){
     const invalid=[400,422].includes(result.status);
     return respond({error:invalid?"Escoge otra contraseña que cumpla los requisitos de seguridad.":"No se pudo confirmar el cambio de contraseña."},invalid?400:503);
    }
    return respond({ok:true});
   }

   const confirmation=String(body.confirmation||"").trim().toLowerCase();
   const email=String(student?.email||"").trim().toLowerCase();
   const expected=goodEmail(email)?email:id;
   if(student ? confirmation!==expected : !goodEmail(confirmation)&&confirmation!==id){
    return respond({error:"La confirmación no coincide con la cuenta."},400);
   }
   if(!student)return respond({ok:true});
   if(student.status!=="deleting"){
    const frozen=await db(profilePath+"&role=eq.student&select=id",{
     method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"deleting"})
    });
    if(!frozen?.length)return respond({error:"La cuenta cambió. Actualiza el directorio."},409);
   }
   const pending=()=>respond({error:"La cuenta quedó bloqueada. Reintenta la eliminación desde el directorio.",pending:true},503);
   try{
    if(!await removeStudentFiles(id))return pending();
    const removed=await fetch(authPath,{
     method:"DELETE",headers:svc(),body:JSON.stringify({should_soft_delete:false})
    });
    if(!removed.ok&&removed.status!==404)return pending();
    const remaining=await db(profilePath+"&select=id");
    return remaining?.length?pending():respond({ok:true});
   }catch{
    return pending();
   }
  }
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
