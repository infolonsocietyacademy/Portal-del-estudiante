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
const PORTAL = Deno.env.get("OLON_PORTAL_URL") ||
 "https://infolonsocietyacademy.github.io/Portal-del-estudiante/";
const accountLink = (mode:string) => new URL("recuperar.html?mode="+mode, PORTAL).toString();
async function whoIsAdmin(req:Request, fresh:boolean){
 const authorization=req.headers.get("Authorization")||"";
 if(!/^Bearer [^ ]+$/i.test(authorization))return null;
 const headers={Authorization:authorization,apikey:PUBLIC,"Content-Type":"application/json"};
 const gate=await fetch(URL_BASE+"/rest/v1/rpc/olon_security_can_admin",{
  method:"POST",headers,body:JSON.stringify({p_fresh:fresh})
 });
 if(!gate.ok||await gate.json()!==true)return null;
 const auth=await fetch(URL_BASE+"/auth/v1/user",{headers});
 if(!auth.ok)return null;
 const user=await auth.json().catch(()=>null);
 return goodId(user?.id)?user:null;
}
async function audit(actor:string,subject:string|null,action:string){
 try{
  await db("rpc/olon_registration_audit",{method:"POST",
   body:JSON.stringify({p_actor:actor,p_subject:subject,p_action:action})});
 }catch{
  console.error("OLON registration audit was not accepted.");
 }
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
   const accepted=()=>respond({ok:true,message:"Recibimos la solicitud. Si corresponde, un administrador revisará el acceso."});
   if(body?.website)return accepted();
   const remote=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim();
   const ipHash=await hex(remote+"|"+SERVICE.slice(0,32));
   const fifteen=new Date(Date.now()-15*60_000).toISOString();
   const recent=await db("access_requests?ip_hash=eq."+ipHash+"&created_at=gte."+encodeURIComponent(fifteen)+"&select=id&limit=6");
   if(recent.length>=5)return respond({error:"Demasiadas solicitudes recientes. Intenta más tarde."},429);
   const duplicate=await db("access_requests?email=eq."+encodeURIComponent(email)+"&status=eq.pending&select=id&limit=1");
   if(duplicate.length)return accepted();
   const exists=await db("profiles?email=eq."+encodeURIComponent(email)+"&select=id&limit=1");
   if(exists.length)return accepted();
   try{
    await db("access_requests",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify([{full_name,email,ip_hash:ipHash}])});
   }catch(e){if((e as any).code==="23505")return accepted();throw e}
   return accepted();
  }
  const admin=await whoIsAdmin(req,action!=="list");
  if(!admin)return respond({error:"Se requiere una sesión administrativa con MFA verificado."},403);
  if(action==="send_student_recovery"||action==="delete_student"){
   const id=String(body.id||"").toLowerCase();
   if(!goodId(id)||id===admin.id)return respond({error:"Selecciona una cuenta de estudiante válida."},400);
   const profilePath="profiles?id=eq."+encodeURIComponent(id);
   const students=await db(profilePath+"&select=id,email,role,status");
   const student=students?.[0];
   if(student && student.role!=="student")return respond({error:"La cuenta seleccionada está protegida."},403);
   const authPath=URL_BASE+"/auth/v1/admin/users/"+encodeURIComponent(id);

   if(action==="send_student_recovery"){
    if(!student)return respond({error:"La cuenta ya no está en el portal."},404);
    if(student.status==="deleting")return respond({error:"La cuenta está pendiente de eliminación."},409);
    const authUser=await fetch(authPath,{headers:svc()});
    const current=await authUser.json().catch(()=>null);
    const email=String(current?.user?.email||current?.email||"").trim().toLowerCase();
    if(!authUser.ok||!goodEmail(email))return respond({error:"La cuenta no tiene un correo disponible para recuperación."},409);
    const redirect=encodeURIComponent(accountLink("update"));
    const result=await fetch(URL_BASE+"/auth/v1/recover?redirect_to="+redirect,{
     method:"POST",headers:svc(),body:JSON.stringify({email})
    });
    if(!result.ok)return respond({error:"Supabase no aceptó el envío. Revisa la configuración de correo."},503);
    await audit(admin.id,id,"recovery_email_requested");
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
    if(remaining?.length)return pending();
    await audit(admin.id,id,"student_deleted");
    return respond({ok:true});
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
   const rows=await db("access_requests?id=eq."+encodeURIComponent(id)+"&status=eq.pending",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"rejected",processed_at:new Date().toISOString()})});
   if(!rows?.length)return respond({error:"La solicitud ya fue procesada."},409);
   await audit(admin.id,null,"request_rejected");
   return respond({ok:true});
  }
  if(action==="approve"){
   const id=String(body.id||"");
   if(!goodId(id))return respond({error:"Solicitud inválida."},400);
   const rows=await db("access_requests?id=eq."+encodeURIComponent(id)+"&status=eq.pending&select=id,full_name,email");
   const reqRow=rows?.[0];
   if(!reqRow)return respond({error:"Solicitud no encontrada o ya procesada."},404);
   const existing=await db("profiles?email=eq."+encodeURIComponent(reqRow.email)+"&select=id,role,status&limit=1");
   let newId=String(existing?.[0]?.id||"");
   if(newId){
    const found=await fetch(URL_BASE+"/auth/v1/admin/users/"+encodeURIComponent(newId),{headers:svc()});
    const payload=await found.json().catch(()=>null);
    const user=payload?.user||payload;
    if(!found.ok||!user?.invited_at||user?.user_metadata?.olon_request_id!==id){
     return respond({error:"El correo ya pertenece a otra cuenta. Revisa la solicitud antes de activarla."},409);
    }
   }
   if(!newId){
    const redirect=encodeURIComponent(accountLink("invite"));
    const result=await fetch(URL_BASE+"/auth/v1/invite?redirect_to="+redirect,{method:"POST",headers:svc(),
     body:JSON.stringify({email:reqRow.email,data:{full_name:reqRow.full_name,olon_request_id:id}})});
    const invited=await result.json().catch(()=>({}));
    newId=String(invited?.user?.id||invited?.id||"");
    if(!result.ok||!goodId(newId)){
     return respond({error:"No se pudo enviar la invitación. Revisa el servicio de correo y vuelve a intentar."},503);
    }
   }
   const activated=await db("rpc/olon_finish_registration",{method:"POST",
    body:JSON.stringify({p_request:id,p_user:newId,p_actor:admin.id})});
   if(activated!==true)return respond({error:"No se activó la cuenta. Verifica que la invitación corresponda a esta solicitud."},409);
   return respond({ok:true,message:"Supabase aceptó la invitación y la cuenta se activó."});
  }
  return respond({error:"Acción no permitida"},400);
 }catch(e){console.error("OLON registration request failed.",(e as {status?:number})?.status||503);return respond({error:"No se pudo completar la operación. Revisa la conexión e inténtalo de nuevo."},503)}
});
