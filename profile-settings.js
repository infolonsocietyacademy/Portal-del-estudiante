(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const dialog = byId("profileDialog");
  const form = byId("profileForm");
  const nameInput = form.elements.namedItem("display_name");
  const feedback = byId("profileFeedback");
  const types = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
  const columns = "display_name,avatar_path,cover_path,revision";
  const bucket = () => supabaseClient.storage.from("olon-profile-media");
  const profiles = () => supabaseClient.from("olon_profile_media");
  const photos = [
    {key:"avatar", column:"avatar_path", width:480, height:480, preview:"profileAvatarPreview"},
    {key:"cover", column:"cover_path", width:1600, height:640, preview:"profileCoverPreview"}
  ];
  let account = null;
  let draft = null;

  function note(text = "", isError = false){
    feedback.textContent = text;
    feedback.dataset.error = String(isError);
    feedback.hidden = !text;
  }

  function initial(name){
    return Array.from(name.trim())[0]?.toLocaleUpperCase("es") || "O";
  }

  function displayName(state){
    return state.row?.display_name || state.originalName;
  }

  function showImage(image, url){
    if(url){
      if(image.getAttribute("src") !== url) image.src = url;
      image.hidden = false;
    }else{
      image.hidden = true;
      image.removeAttribute("src");
    }
    const fallback = image.previousElementSibling;
    if(fallback?.matches("[data-profile-initials],#profilePreviewInitials")) fallback.hidden = Boolean(url);
  }

  function render(state){
    const name = displayName(state);
    byId("studentName").textContent = name;
    byId("portalWelcomeText").textContent = "Hola, " + name;
    byId("adminProfileName").textContent = name;
    document.querySelectorAll("[data-profile-initials]").forEach(label => { label.textContent = initial(name); });
    if(state.renderedName !== name){
      state.renderedName = name;
      window.dispatchEvent(new CustomEvent("olon:profile-name-changed",{detail:{name}}));
    }
    document.querySelectorAll("[data-profile-photo]").forEach(image => showImage(image,state.urls[image.dataset.profilePhoto]));
  }

  async function read(owner){
    const {data,error} = await profiles().select(columns).eq("student_id",owner).maybeSingle();
    if(error) throw error;
    return data;
  }

  async function showSaved(state,row){
    if(state !== account) return;
    state.row = row;
    // El apodo se muestra en cuanto se confirma, sin esperar a las fotos.
    render(state);
    const urls = await Promise.all(photos.map(async photo => {
      const path = row?.[photo.column];
      if(!path) return [photo.key,null];
      try{
        const {data} = await bucket().createSignedUrl(path, 3600);
        return [photo.key,data?.signedUrl || null];
      }catch{
        return [photo.key,null];
      }
    }));
    if(state !== account) return;
    state.urls = Object.fromEntries(urls);
    render(state);
  }

  function reload(state){
    if(!state.loading){
      state.loading = read(state.owner).then(row => showSaved(state,row))
        .finally(() => { state.loading = null; });
    }
    return state.loading;
  }

  function start(){
    if(!currentUser) return;
    if(currentUser.id === account?.owner){
      render(account);
      return;
    }
    clear();
    const state = {
      owner:currentUser.id, originalName:currentUser.full_name?.trim() || (isAdminUser(currentUser) ? "Admin" : "Estudiante"),
      row:null, urls:{}, loading:null
    };
    account = state;
    render(state);
    void reload(state).catch(() => {});
  }

  function resetDraft(){
    if(draft){
      for(const photo of photos){
        const previewUrl = draft[photo.key].previewUrl;
        if(previewUrl) URL.revokeObjectURL(previewUrl);
      }
    }
    draft = null;
    form.reset();
    setBusy(false,false);
    note();
  }

  function clear(){
    if(dialog.open) dialog.close();
    resetDraft();
    account = null;
    document.querySelectorAll("[data-profile-photo]").forEach(image => showImage(image,null));
    for(const photo of photos) showImage(byId(photo.preview),null);
  }

  function renderDraftPhoto(editing,photo){
    const selection = editing[photo.key];
    const existing = editing.baseline?.[photo.column];
    const remove = form.querySelector('[data-remove-profile-photo="' + photo.key + '"]');
    showImage(byId(photo.preview),selection.previewUrl || (!selection.remove && editing.account.urls[photo.key]));
    remove.hidden = !existing && !selection.file;
    remove.textContent = selection.remove && existing ? "Conservar " + (photo.key === "cover" ? "portada" : "foto")
      : "Quitar " + (photo.key === "cover" ? "portada" : "foto");
  }

  async function open(){
    const state = account;
    if(!state || state.owner !== currentUser?.id || dialog.open) return;
    resetDraft();
    const editing = {account:state, ready:false, saving:false, avatar:{}, cover:{}};
    draft = editing;
    setBusy(false,false);
    nameInput.value = displayName(state);
    byId("profilePreviewInitials").textContent = initial(nameInput.value);
    photos.forEach(photo => renderDraftPhoto(editing,photo));
    note("Cargando tu perfil…");
    dialog.showModal();
    try{
      await reload(state);
      if(draft !== editing || account !== state || !dialog.open) return;
      editing.baseline = state.row;
      editing.ready = true;
      nameInput.value = displayName(state);
      byId("profilePreviewInitials").textContent = initial(nameInput.value);
      photos.forEach(photo => renderDraftPhoto(editing,photo));
      note();
      setBusy(false,true);
    }catch{
      if(draft === editing) note("No se pudo cargar tu perfil. Cierra la ventana y vuelve a abrirla.",true);
    }
  }

  function setFile(editing,photo,file){
    const selection = editing[photo.key];
    if(selection.previewUrl) URL.revokeObjectURL(selection.previewUrl);
    selection.file = file || null;
    selection.previewUrl = file ? URL.createObjectURL(file) : null;
  }

  nameInput.addEventListener("input", () => {
    byId("profilePreviewInitials").textContent = initial(nameInput.value || draft?.account.originalName || "O");
  });

  for(const photo of photos){
    const input = form.elements.namedItem(photo.key);
    input.addEventListener("change", () => {
      const editing = draft;
      if(!editing?.ready || editing.saving) return;
      const file = input.files[0];
      const imageType = file && (types.has(file.type) ||
        ((!file.type || file.type === "application/octet-stream") && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)));
      if(file && (!imageType || !file.size || file.size > 20 * 1024 * 1024)){
        input.value = "";
        setFile(editing,photo,null);
        renderDraftPhoto(editing,photo);
        note("Selecciona una imagen compatible de hasta 20 MB.",true);
        return;
      }
      setFile(editing,photo,file);
      if(file) editing[photo.key].remove = false;
      renderDraftPhoto(editing,photo);
      note();
    });
    form.querySelector('[data-remove-profile-photo="' + photo.key + '"]').addEventListener("click", () => {
      const editing = draft;
      if(!editing?.ready || editing.saving) return;
      const selection = editing[photo.key];
      selection.remove = !selection.remove && Boolean(editing.baseline?.[photo.column]);
      input.value = "";
      setFile(editing,photo,null);
      renderDraftPhoto(editing,photo);
      note();
    });
  }

  async function encodePhoto(url,photo){
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(image.naturalWidth / photo.width, image.naturalHeight / photo.height);
    const sw = photo.width * ratio, sh = photo.height * ratio;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(photo.width, Math.round(sw)));
    canvas.height = Math.max(1, Math.min(photo.height, Math.round(sh)));
    const context = canvas.getContext("2d",{alpha:false});
    context.fillStyle = "#e6ebe5";
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,(image.naturalWidth-sw)/2,(image.naturalHeight-sh)/2,sw,sh,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,"image/jpeg",0.86));
    if(!blob || blob.type !== "image/jpeg" || blob.size > 3 * 1024 * 1024) throw new Error("Invalid image");
    return blob;
  }

  async function discard(paths){
    if(!paths.length) return;
    try{ await bucket().remove(paths); }catch{ /* Saved references are protected by the bucket policy. */ }
  }

  function setBusy(busy,ready){
    for(const control of dialog.querySelectorAll("button,input")){
      control.disabled = busy || (!ready && !control.hasAttribute("data-close-profile"));
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const editing = draft;
    const state = editing?.account;
    if(!editing?.ready || editing.saving || state !== account || state.owner !== currentUser?.id) return;
    const baseline = editing.baseline;
    const typedName = nameInput.value.trim();
    const fields = {display_name:typedName && typedName !== state.originalName ? typedName : null};
    const uploaded = [];
    let mayDiscard = true;
    let invalidPhoto = false;
    editing.saving = true;
    setBusy(true,false);
    note("Guardando tu perfil…");
    try{
      for(const photo of photos){
        const selection = editing[photo.key];
        fields[photo.column] = selection.remove ? null : baseline?.[photo.column] || null;
        if(!selection.file) continue;
        invalidPhoto = true;
        const image = await encodePhoto(selection.previewUrl,photo);
        invalidPhoto = false;
        const path = state.owner + "/" + photo.key + "/" + crypto.randomUUID() + ".jpg";
        uploaded.push(path);
        const {error} = await bucket().upload(path,image,{contentType:"image/jpeg",upsert:false});
        if(error) throw error;
        fields[photo.column] = path;
      }
      if(Object.keys(fields).every(key => fields[key] === (baseline?.[key] ?? null))){
        dialog.close();
        return;
      }
      mayDiscard = false;
      const query = baseline
        ? profiles().update(fields).eq("student_id",state.owner).eq("revision",baseline.revision)
        : profiles().insert({...fields,student_id:state.owner});
      const result = await query.select(columns).maybeSingle();
      let saved = result.data;
      if(result.error || !saved){
        const newest = await read(state.owner);
        if(newest && Object.keys(fields).every(key => newest[key] === fields[key])) saved = newest;
        else{
          mayDiscard = true;
          if((newest?.revision ?? null) !== (baseline?.revision ?? null)){
            editing.ready = false;
            throw new Error("Perfil cambiado");
          }
          throw result.error || new Error("Perfil sin guardar");
        }
      }
      const retired = photos.map(photo => baseline?.[photo.column]).filter(path =>
        path && path !== saved.avatar_path && path !== saved.cover_path);
      if(state === account){
        await showSaved(state,saved);
        if(draft === editing) dialog.close();
      }
      void discard(retired);
    }catch{
      if(mayDiscard) void discard(uploaded);
      if(draft === editing){
        note(invalidPhoto ? "Tu navegador no pudo abrir esa imagen. Prueba con JPG, PNG o WebP."
          : editing.ready ? "No se pudieron guardar los cambios. Inténtalo de nuevo."
          : "El perfil cambió en otra sesión. Cierra la ventana y vuelve a abrirla.",true);
      }
    }finally{
      if(draft === editing){
        editing.saving = false;
        setBusy(false,editing.ready);
      }
    }
  });

  document.addEventListener("click", event => {
    if(event.target.closest("[data-edit-profile]")) void open();
    if(event.target.closest("[data-close-profile]") && !draft?.saving) dialog.close();
  });
  dialog.addEventListener("cancel", event => { if(draft?.saving) event.preventDefault(); });
  dialog.addEventListener("close", () => { if(!dialog.open) resetDraft(); });

  window.olonProfile = {start, clear};
})();

