(() => {
  "use strict";

  const dialog = document.getElementById("appearanceDialog");
  const form = document.getElementById("appearanceForm");
  const feedback = document.getElementById("appearanceFeedback");
  const password = document.getElementById("olonChangePasswordBtn");
  const sounds = document.getElementById("soundSwitch");
  const guestKey = "olon_trader_guest_appearance";
  const defaultStyle = {mode:"dark",accent:"#6aa7ef",text:null,font:"inter",fontSize:100};
  const fonts = {
    inter:'Inter,system-ui,-apple-system,"Segoe UI",sans-serif',
    system:'system-ui,-apple-system,"Segoe UI",sans-serif',
    rounded:'"Trebuchet MS",system-ui,sans-serif',
    serif:'Georgia,"Times New Roman",serif',
    mono:'var(--font-mono)'
  };
  const palettes = {
    light:{text:"#17263a",surfaces:["#f2f5fa","#ffffff","#e9eff7"]},
    dark:{text:"#e9effa",surfaces:["#101622","#192232","#222d40"]}
  };
  let owner = null;
  let saved = readGuest();
  let draft = saved;
  let saving = false;
  let chartFrame = 0;

  function hex(value){
    return typeof value === "string" && /^#[a-f\d]{6}$/i.test(value) ? value.toLowerCase() : null;
  }

  function normalize(value){
    return {
      mode:value?.mode === "dark" ? "dark" : "light",
      accent:hex(value?.accent) || defaultStyle.accent,
      text:hex(value?.text),
      font:Object.hasOwn(fonts,value?.font) ? value.font : defaultStyle.font,
      fontSize:Math.min(125,Math.max(85,Number(value?.fontSize) || 100))
    };
  }

  function readGuest(){
    try{
      return normalize(JSON.parse(localStorage.getItem(guestKey)) || {mode:localStorage.getItem("olon_theme_mode") || defaultStyle.mode,accent:defaultStyle.accent,font:defaultStyle.font});
    }catch{ return {...defaultStyle}; }
  }

  function rgb(color){
    return color.slice(1).match(/../g).map(channel => parseInt(channel,16));
  }

  function luminance(color){
    const channels = rgb(color).map(value => {
      const unit = value / 255;
      return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }

  function contrast(a,b){
    const left = luminance(a), right = luminance(b);
    return (Math.max(left,right) + .05) / (Math.min(left,right) + .05);
  }

  function legible(color,mode){
    const surfaces = palettes[mode].surfaces;
    if(surfaces.every(surface => contrast(color,surface) >= 4.5)) return color;
    const channels = rgb(color);
    const target = mode === "dark" ? 255 : 0;
    for(let step = 1; step <= 20; step++){
      const candidate = "#" + channels.map(channel =>
        Math.round(channel + (target - channel) * step / 20).toString(16).padStart(2,"0")
      ).join("");
      if(surfaces.every(surface => contrast(candidate,surface) >= 4.5)) return candidate;
    }
    return palettes[mode].text;
  }

  function apply(theme){
    const palette = palettes[theme.mode];
    const ink = theme.text ? legible(theme.text,theme.mode) : palette.text;
    const body = document.body;
    body.classList.toggle("atlas-dark",theme.mode === "dark");
    document.documentElement.style.colorScheme = theme.mode;
    body.style.setProperty("--trader-accent",theme.accent);
    body.style.setProperty("--trader-accent-ink",legible(theme.accent,theme.mode));
    body.style.setProperty("--trader-accent-on",contrast(theme.accent,"#ffffff") >= 4.5 ? "#ffffff" : "#000000");
    body.style.setProperty("--trader-text",ink);
    body.style.setProperty("--trader-font",fonts[theme.font]);
    body.style.setProperty("--trader-font-scale",String(theme.fontSize / 100));
    document.documentElement.style.setProperty("--trader-font-scale",String(theme.fontSize / 100));
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",palette.surfaces[0]);
    document.getElementById("appearanceAccentHex").value = theme.accent.toUpperCase();
    document.getElementById("appearanceContrast").hidden = !theme.text || theme.text === ink;
    cancelAnimationFrame(chartFrame);
    chartFrame = requestAnimationFrame(() => {
      if(typeof chart !== "undefined" && chart) renderChart();
    });
  }

  function populate(){
    form.elements.mode.value = draft.mode;
    form.elements.accent.value = draft.accent;
    form.elements.text.value = draft.text || palettes[draft.mode].text;
    form.elements.font.value = draft.font;
    form.elements.fontSize.value = String(draft.fontSize);
    document.getElementById("appearanceFontSizeValue").textContent = draft.fontSize + "%";
    document.getElementById("appearanceTextAuto").setAttribute("aria-pressed",String(!draft.text));
    apply(draft);
  }

  function note(text = "", error = false){
    feedback.textContent = text;
    feedback.hidden = !text;
    feedback.dataset.error = String(error);
  }

  function setAccount(user){
    owner = user?.id || null;
    saved = owner ? normalize(user.user_metadata?.olon_appearance || {mode:readGuest().mode}) : readGuest();
    draft = saved;
    if(dialog.open) dialog.close();
    apply(saved);
  }

  function open(){
    if(dialog.open) return;
    draft = {...saved};
    populate();
    password.hidden = !owner;
    sounds.checked = localStorage.getItem("olon_sound_enabled") !== "false";
    note();
    dialog.showModal();
  }

  function busy(value){
    saving = value;
    dialog.querySelectorAll("button,input,select").forEach(control => { control.disabled = value; });
    document.getElementById("appearanceSave").textContent = value ? "Guardando…" : "Guardar apariencia";
  }

  form.addEventListener("input", event => {
    const input = event.target;
    if(input.name === "mode" && input.checked) draft.mode = input.value;
    if(input.name === "accent") draft.accent = input.value;
    if(input.name === "text") draft.text = input.value;
    if(input.name === "font") draft.font = input.value;
    if(input.name === "fontSize") draft.fontSize = Number(input.value);
    populate();
  });

  document.getElementById("appearanceTextAuto").addEventListener("click", () => {
    draft.text = null;
    populate();
  });

  document.getElementById("appearanceReset").addEventListener("click", () => {
    draft = {...defaultStyle,mode:draft.mode};
    populate();
  });

  sounds.addEventListener("change", () => {
    localStorage.setItem("olon_sound_enabled",String(sounds.checked));
    if(sounds.checked) note("Sonidos activados. Pulsa «Probar sonido» para escucharlo.");
    else note("Sonidos desactivados.");
  });

  document.getElementById("soundTestBtn")?.addEventListener("click", () => {
    if(!sounds.checked){
      note("Activa «Sonidos del portal» para escuchar el teclado.",true);
      return;
    }
    if(typeof window.testOlonKeyboardSound !== "function"){
      note("El audio todavía no está disponible. Actualiza la página.",true);
      return;
    }
    // La función reproduce directamente durante el gesto del usuario (incluido iPhone).
    window.testOlonKeyboardSound();
    note("Si no lo escuchas, revisa el volumen del dispositivo y el modo silencio.");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if(saving) return;
    const next = normalize(draft), account = owner;
    busy(true);
    note();
    try{
      if(account){
        const {data,error} = await supabaseClient.auth.updateUser({data:{olon_appearance:next}});
        if(error || data?.user?.id !== account) throw error || new Error("Invalid account");
      }else localStorage.setItem(guestKey,JSON.stringify(next));
      if(owner === account){
        saved = next;
        dialog.close();
      }
    }catch{
      if(owner === account) note("No se pudo guardar tu apariencia. Inténtalo de nuevo.",true);
    }finally{
      busy(false);
    }
  });

  document.addEventListener("click", event => {
    if(event.target.closest("[data-open-appearance]")) open();
    if(event.target.closest("[data-close-appearance]") && !saving) dialog.close();
  });
  dialog.addEventListener("cancel", event => { if(saving) event.preventDefault(); });
  dialog.addEventListener("close", () => apply(saved));

  apply(saved);
  window.olonAppearance = {setAccount};
})();
