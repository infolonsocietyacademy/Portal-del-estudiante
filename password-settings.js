/* OLON | Cambio seguro de contraseña del estudiante */
(()=>{"use strict";
function init(){
 const portal=document.getElementById("portal");if(!portal||document.getElementById("olonChangePasswordBtn"))return;
 const btn=document.createElement("button");btn.id="olonChangePasswordBtn";btn.type="button";btn.textContent="🔐 Cambiar mi contraseña";
 btn.style.cssText="display:block;width:calc(100% - 24px);margin:12px;padding:12px;border:1px solid #c9a968;border-radius:10px;background:#18202c;color:#fff;cursor:pointer;font:inherit";
 const sidebar=document.getElementById("sidebar");if(!sidebar)return;sidebar.append(btn);
 const dialog=document.createElement("dialog");dialog.id="olonPasswordDialog";dialog.style.cssText="border:1px solid #c9a968;border-radius:16px;padding:24px;max-width:420px;width:calc(100% - 32px);background:#171e29;color:white;box-shadow:0 15px 70px #0008";
 dialog.innerHTML='<form id="olonPasswordForm" style="display:grid;gap:12px"><h2 style="margin:0">Cambiar contraseña</h2><p style="margin:0">Escoge una contraseña de al menos 10 caracteres. Solo tú podrás conocerla.</p><label>Contraseña actual<input name="current" type="password" autocomplete="current-password" required style="display:block;width:100%;padding:10px;box-sizing:border-box"></label><label>Nueva contraseña<input name="next" type="password" autocomplete="new-password" minlength="10" required style="display:block;width:100%;padding:10px;box-sizing:border-box"></label><label>Confirmar contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="10" required style="display:block;width:100%;padding:10px;box-sizing:border-box"></label><p id="olonPasswordFeedback" role="status" aria-live="polite"></p><div style="display:flex;gap:10px"><button type="button" id="olonPasswordCancel">Cancelar</button><button type="submit" id="olonPasswordSave">Guardar contraseña</button></div></form>';
 document.body.append(dialog);
 btn.addEventListener("click",async()=>{const {data}=await window.supabaseClient.auth.getUser();if(!data?.user){alert("Inicia sesión para cambiar tu contraseña.");return;}dialog.showModal();});
 dialog.querySelector("#olonPasswordCancel").addEventListener("click",()=>dialog.close());
 dialog.querySelector("form").addEventListener("submit",async e=>{
 e.preventDefault();const form=e.currentTarget,feedback=dialog.querySelector("#olonPasswordFeedback"),save=dialog.querySelector("#olonPasswordSave");
 const current=form.elements.current.value,next=form.elements.next.value,confirm=form.elements.confirm.value;
 if(next.length<10||next!==confirm||current===next){feedback.textContent="Usa al menos 10 caracteres, confirma la nueva contraseña y elige una distinta a la anterior.";return;}
 save.disabled=true;feedback.textContent="Verificando y guardando…";
 try{
 const client=window.supabaseClient;if(!client)throw Error("No hay conexión con Supabase.");
 const {data:{user},error:userError}=await client.auth.getUser();if(userError||!user?.email)throw Error("Tu sesión expiró.");
 const {error:verifyError}=await client.auth.signInWithPassword({email:user.email,password:current});if(verifyError)throw Error("La contraseña actual no es correcta.");
 const {error}=await client.auth.updateUser({password:next,data:{password_changed_at:new Date().toISOString()}});if(error)throw error;
 form.reset();feedback.textContent="✓ Contraseña actualizada. Utiliza la nueva contraseña en tus próximos accesos.";
 setTimeout(()=>{if(dialog.open)dialog.close();feedback.textContent="";},1800);
 }catch(err){feedback.textContent=err.message||"No se pudo actualizar la contraseña.";}finally{save.disabled=false;}
 });
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();