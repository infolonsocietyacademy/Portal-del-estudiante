(() => {
  "use strict";

  const log = document.getElementById("publicChatMessages");
  const latest = document.getElementById("waNewMessagesBtn");
  const status = document.getElementById("publicChatStatus");
  const refreshButton = document.getElementById("publicChatRefresh");
  const form = document.getElementById("publicChatForm");
  const input = document.getElementById("publicChatInput");
  const send = form.querySelector("button[type=submit]");
  const timeFormat = new Intl.DateTimeFormat("es-PR", {
    timeZone:"America/Puerto_Rico", dateStyle:"short", timeStyle:"short"
  });
  const messages = () => supabaseClient.from("general_chat_messages");
  let session = null;

  function note(text, isError = false){
    status.textContent = text;
    status.dataset.error = String(isError);
    status.hidden = !text;
  }

  function empty(text){
    const item = document.createElement("p");
    item.className = "waEmpty";
    item.textContent = text;
    log.replaceChildren(item);
  }

  function atLatest(){
    return log.scrollHeight - log.scrollTop - log.clientHeight < 70;
  }

  function scrollToLatest(){
    log.scrollTop = log.scrollHeight;
    latest.hidden = true;
  }

  function makeMessage(row, owner){
    const item = document.createElement("article");
    item.className = "waBubble";
    item.dataset.messageId = row.id;
    item.classList.toggle("me", row.sender_id === owner);
    item.classList.toggle("admin", row.sender_role === "admin");

    const name = document.createElement("strong");
    name.className = "waName";
    name.textContent = row.sender_name || "Miembro de OLON";
    if(row.sender_role === "admin"){
      const badge = document.createElement("span");
      badge.className = "waRole";
      badge.textContent = "Administración";
      name.append(" ", badge);
    }

    const content = document.createElement("div");
    content.className = "waText";
    content.textContent = row.message;
    item.append(name, content);
    const date = new Date(row.created_at);
    if(row.created_at && Number.isFinite(+date)){
      const time = document.createElement("time");
      time.className = "waMeta";
      time.dateTime = row.created_at;
      time.textContent = timeFormat.format(date);
      item.append(time);
    }
    return item;
  }

  function render(state, rows){
    const follow = state.follow || !state.loaded || atLatest();
    const bounds = log.getBoundingClientRect();
    const anchor = follow ? null : Array.from(log.children)
      .find(item => item.getBoundingClientRect().bottom > bounds.top);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const previous = new Map(Array.from(log.children).map(item => [item.dataset.messageId, item]));
    const incoming = new Set(rows.map(row => row.id));
    const newMessages = state.loaded && rows.some(row =>
      !previous.has(row.id) && row.sender_id !== state.owner
    );

    if(rows.length){
      for(const [id, item] of previous) if(!incoming.has(id)) item.remove();
      let next = log.firstElementChild;
      for(const row of rows){
        if(next?.dataset.messageId === row.id) next = next.nextElementSibling;
        else log.insertBefore(previous.get(row.id) || makeMessage(row,state.owner), next);
      }
    }else if(!state.loaded || !log.querySelector(".waEmpty")){
      empty("Sé el primero en escribir en la comunidad.");
    }

    if(follow) scrollToLatest();
    else{
      if(anchor?.isConnected) log.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
      if(newMessages) latest.hidden = false;
    }
    if(newMessages && !document.hidden && typeof playNewMessageSound === "function") playNewMessageSound();
    state.loaded = true;
    state.follow = false;
  }

  async function refresh(state = session){
    if(!state?.open || state !== session || document.hidden) return;
    if(state.refreshing){
      state.refreshAgain = true;
      return;
    }
    state.refreshing = true;
    refreshButton.disabled = true;
    try{
      const {data,error} = await messages().select("id,sender_id,sender_name,sender_role,message,created_at")
        .order("created_at",{ascending:false,nullsFirst:false}).order("id",{ascending:false}).limit(150);
      if(state !== session || !state.open) return;
      if(error) throw error;
      render(state, data.reverse());
      if(state.loadFailed && !state.pending) note("");
      state.loadFailed = false;
    }catch{
      if(state !== session || !state.open) return;
      state.loadFailed = true;
      if(!state.loaded) empty("El historial todavía no está disponible.");
      if(!state.pending) note("No se pudo actualizar el chat. Pulsa Actualizar para reintentar.", true);
    }finally{
      state.refreshing = false;
      if(state === session) refreshButton.disabled = false;
      if(state.refreshAgain){
        state.refreshAgain = false;
        void refresh(state);
      }
    }
  }

  function setOpen(open){
    const owner = currentUser?.id;
    if(!owner) return;
    if(session && session.owner !== owner) clear();
    if(!session && !open) return;
    if(!session) session = {owner, open:false, loaded:false, follow:true, pending:null};
    const state = session;
    if(open === state.open) return;
    state.open = open;
    if(!open){
      clearInterval(state.timer);
      return;
    }
    if(!state.loaded && !state.loadFailed) empty("Cargando mensajes…");
    state.follow = true;
    state.channel ||= supabaseClient.channel("olon-community-chat")
      .on("postgres_changes", {event:"*",schema:"public",table:"general_chat_messages"}, () => void refresh(state))
      .subscribe(result => {
        if(result === "SUBSCRIBED") void refresh(state);
      });
    state.timer = setInterval(() => void refresh(state), 15_000);
    void refresh(state);
  }

  function clear(){
    if(session?.channel){
      clearInterval(session.timer);
      void supabaseClient.removeChannel(session.channel);
    }
    session = null;
    log.replaceChildren();
    input.value = "";
    latest.hidden = true;
    refreshButton.disabled = send.disabled = false;
    note("");
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const state = session;
    const message = input.value.trim();
    if(!message || !state?.open || currentUser?.id !== state.owner || send.disabled) return;
    if(state.pending?.message !== message) state.pending = {id:crypto.randomUUID(), message};
    const {id} = state.pending;
    send.disabled = true;
    note("Enviando…");
    try{
      const result = await messages().insert({id,sender_id:state.owner,message}).select("id").single();
      if(result.error){
        const previous = await messages().select("id").eq("id",id).eq("sender_id",state.owner).maybeSingle();
        if(previous.error || !previous.data) throw result.error;
      }
      if(state !== session) return;
      if(input.value.trim() === message) input.value = "";
      state.pending = null;
      state.follow = true;
      note("");
      void refresh(state);
    }catch{
      if(state === session) note("No se pudo enviar el mensaje. Tu texto sigue aquí para que puedas reintentar.", true);
    }finally{
      if(state === session) send.disabled = false;
    }
  });

  input.addEventListener("keydown", event => {
    if(event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener("click", event => {
    const emoji = event.target.closest("[data-chat-emoji]");
    if(!emoji) return;
    const start = input.selectionStart, end = input.selectionEnd;
    const text = emoji.textContent;
    if(input.value.length - (end - start) + text.length > input.maxLength) return;
    input.setRangeText(text,start,end,"end");
    input.focus();
  });
  log.addEventListener("scroll", () => { if(atLatest()) latest.hidden = true; });
  latest.addEventListener("click", scrollToLatest);
  refreshButton.addEventListener("click", () => void refresh());
  document.addEventListener("visibilitychange", () => { if(!document.hidden) void refresh(); });

  window.olonCommunity = {setOpen, clear};
})();
