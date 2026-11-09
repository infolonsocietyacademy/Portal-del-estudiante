/* Admin-authored portal reminders. Data stays in Supabase with admin-only RLS writes. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const form=$("olonReminderForm");
  const studentPanel=$("olonStudentReminders");
  if(!form||!studentPanel)return;
  const studentList=$("olonStudentReminderList");
  const adminList=$("olonReminderAdminList");
  const submit=$("olonReminderPublish"),cancel=$("olonReminderCancel");
  const feedback=$("olonReminderAdminFeedback");
  const table=()=>supabaseClient.from("olon_portal_reminders");
  const isAdmin=()=>typeof currentUser!=="undefined" && !!currentUser && typeof isAdminUser==="function" && isAdminUser(currentUser);
  const isStudent=()=>typeof currentUser!=="undefined" && !!currentUser && !isAdmin();
  const isOpen=()=>!$("portal")?.classList.contains("hidden");
  const formatDate=value=>{try{return new Intl.DateTimeFormat("es-PR",{timeZone:"UTC",dateStyle:"medium"}).format(new Date(value+"T00:00:00Z"));}catch{return value;}};
  let editing=null, busy=false,request=0,loadedFor=null,visiblePage=false;
  function node(tag,text,cls){
    const el=document.createElement(tag);
    if(text!==undefined&&text!==null)el.textContent=String(text);
    if(cls)el.className=cls;
    return el;
  }
  function button(label,cb){
    const b=node("button",label,"btn secondary");
    b.type="button";b.addEventListener("click",cb);
    return b;
  }
  function say(message="",tone=""){
    if(!feedback)return;
    feedback.textContent=message;
    feedback.dataset.tone=tone;
    feedback.hidden=!message;
  }
  function clearEditing(){
    editing=null;form.reset();submit.textContent="Publicar recordatorio";cancel.hidden=true;
  }
  async function read(){
    const {data,error}=await table().select("id,title,message,active,expires_on,created_at")
      .order("created_at",{ascending:false}).limit(60);
    if(error)throw error;
    return data||[];
  }
  function paintStudent(rows){
    studentList.replaceChildren();
    if(!rows.length){studentPanel.hidden=true;return;}
    for(const item of rows){
      const card=node("article",null,"olonReminderStudentItem");
      card.append(node("strong",item.title));
      card.append(node("p",item.message));
      if(item.expires_on)card.append(node("small","Aviso hasta "+formatDate(item.expires_on)));
      studentList.append(card);
    }
    studentPanel.hidden=false;
  }
  function paintAdmin(rows){
    adminList.replaceChildren();
    if(!rows.length){adminList.append(node("p","Aún no tienes recordatorios publicados.","olonRemindersEmpty"));return;}
    for(const item of rows){
      const card=node("article",null,"olonReminderAdminItem");
      const copy=node("div"),actions=node("div",null,"olonReminderButtons");
      copy.append(node("h5",item.title),node("p",item.message));
      copy.append(node("small",(item.active?"Publicado":"Oculto")+(item.expires_on?" · Hasta "+formatDate(item.expires_on):" · Sin vencimiento")));
      const edit=button("Editar",()=>{
        editing=item;form.elements.namedItem("title").value=item.title;
        form.elements.namedItem("message").value=item.message;
        form.elements.namedItem("expires_on").value=item.expires_on||"";
        submit.textContent="Guardar cambios";cancel.hidden=false;
        form.scrollIntoView({behavior:"smooth",block:"center"});
        form.elements.namedItem("title").focus();
      });
      const toggle=button(item.active?"Ocultar":"Publicar",async()=>{
        if(busy||!isAdmin())return;
        busy=true;toggle.disabled=true;say();
        try{
          const {error}=await table().update({active:!item.active}).eq("id",item.id);
          if(error)throw error;
          if(editing?.id===item.id)clearEditing();
          await refresh(true);
          say(item.active?"Recordatorio ocultado.":"Recordatorio publicado.","success");
        }catch{say("No se pudo cambiar el estado del recordatorio.","error");}
        finally{busy=false;toggle.disabled=false;}
      });
      const del=button("Eliminar",async()=>{
        if(busy||!isAdmin()||!confirm("¿Eliminar definitivamente este recordatorio?"))return;
        busy=true;del.disabled=true;say();
        try{
          const {error}=await table().delete().eq("id",item.id);
          if(error)throw error;
          if(editing?.id===item.id)clearEditing();
          await refresh(true);say("Recordatorio eliminado.","success");
        }catch{say("No se pudo eliminar el recordatorio.","error");}
        finally{busy=false;del.disabled=false;}
      });
      del.classList.add("academyClassDelete");
      actions.append(edit,toggle,del);card.append(copy,actions);adminList.append(card);
    }
  }
  async function refresh(manage=false){
    if(!isOpen()||!currentUser)return;
    const owner=currentUser.id,seq=++request;
    const admin=isAdmin();
    if(manage&&!admin)return;
    if(!admin&&manage)return;
    if(!admin&&studentPanel.hidden&&studentList.childElementCount===0)studentPanel.hidden=true;
    try{
      const rows=await read();
      if(seq!==request||!isOpen()||currentUser?.id!==owner)return;
      if(admin){
        if(manage||!adminList.childElementCount)paintAdmin(rows);
        studentPanel.hidden=true;
      }else{
        const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Puerto_Rico",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
        paintStudent(rows.filter(r=>r.active&&(!r.expires_on||r.expires_on>=today)));
      }
      loadedFor=owner;
    }catch(e){
      if(admin){if(manage)say("No se pudieron cargar los recordatorios. Verifica la conexión.","error");}
      else studentPanel.hidden=true;
      console.warn("OLON recordatorios",e?.message);
    }
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!isAdmin()||busy)return;
    const title=String(form.elements.namedItem("title").value||"").trim();
    const message=String(form.elements.namedItem("message").value||"").trim();
    const expires_on=String(form.elements.namedItem("expires_on").value||"").trim()||null;
    if(!title||title.length>120||!message||message.length>1500){say("Completa el título y el mensaje dentro del límite permitido.","error");return;}
    busy=true;submit.disabled=true;say();
    try{
      const payload={title,message,expires_on};
      const result=editing
        ? await table().update(payload).eq("id",editing.id)
        : await table().insert({...payload,active:true});
      if(result.error)throw result.error;
      const revised=!!editing;
      clearEditing();await refresh(true);
      say(revised?"Cambios guardados.":"Recordatorio enviado al portal de los estudiantes.","success");
    }catch(e){say("No se pudo guardar el recordatorio. Revisa los permisos y los campos.","error");console.warn("OLON recordatorio no guardado",e?.message);}
    finally{busy=false;submit.disabled=false;}
  });
  cancel.addEventListener("click",clearEditing);
  function sync(){
    if(!isOpen()||!currentUser){
      loadedFor=null;request++;studentPanel.hidden=true;studentList.replaceChildren();adminList.replaceChildren();return;
    }
    if(isAdmin()){
      studentPanel.hidden=true;
      if(loadedFor!==currentUser.id)void refresh(true);
    }else{
      if(loadedFor!==currentUser.id)void refresh();
    }
  }
  const portal=$("portal");
  if(portal)new MutationObserver(sync).observe(portal,{attributes:true,attributeFilter:["class"]});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&isOpen())void refresh(isAdmin());});
  setInterval(()=>{if(isOpen()&&!document.hidden)void refresh(isAdmin());},60000);
  document.addEventListener("click",event=>{
    if(event.target.closest('[data-academy-page="academyAdminClassesPage"]'))return;
    if(event.target.closest('[onclick*="adminReminderBlock"]'))void refresh(true);
  });
  window.olonPortalReminders={refresh:()=>refresh(isAdmin())};
  sync();
})();
