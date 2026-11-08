/* OLON — terminal interior typewriter. Solo elementos visuales; no cambia datos ni autenticacion. */
(function(){
  "use strict";
  function ready(){
    const portal = document.getElementById("portal");
    const word = document.getElementById("cyberInteriorTypedTrader");
    const greeting = document.getElementById("portalWelcomeText");
    const dashboard = document.getElementById("dashboard");
    if(!portal || !word || !greeting || !dashboard) return;

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    let started = false;
    let pending = [];
    let greetingVersion = 0;

    function schedule(fn,ms){
      const id = window.setTimeout(fn,ms);
      pending.push(id);
    }
    function stop(){
      greetingVersion++;
      pending.forEach(id => window.clearTimeout(id));
      pending = [];
      word.textContent = "TRADER";
      word.classList.remove("cyberTypingActive");
      greeting.classList.remove("cyberTypingActive");
      // No cambiar el saludo del estudiante al cerrar sesion; lo maneja el portal.
    }
    function write(target,fullText,step,delay){
      let index = 0;
      const version = greetingVersion;
      target.classList.add("cyberTypingActive");
      target.textContent = "";
      function tick(){
        if(target === greeting && version !== greetingVersion) return;
        if(portal.classList.contains("hidden")){
          target.textContent = fullText;
          target.classList.remove("cyberTypingActive");
          return;
        }
        index++;
        target.textContent = fullText.slice(0,index);
        if(index < fullText.length) schedule(tick,step);
        else schedule(() => target.classList.remove("cyberTypingActive"),1400);
      }
      schedule(tick,delay);
    }
    function onPortalVisibility(){
      if(portal.classList.contains("hidden")){
        if(started){
          stop();
          started = false;
        }
        return;
      }
      if(started) return;
      started = true;
      if(reduceMotion && reduceMotion.matches) return;
      // Al abrir el portal ya se ha cargado el nombre desde la sesion existente.
      schedule(() => {
        if(portal.classList.contains("hidden")) return;
        const greetingText = (greeting.textContent || "Hola, Estudiante").trim();
        greeting.setAttribute("aria-label",greetingText);
        greeting.setAttribute("aria-live","off");
        write(word,"TRADER",105,80);
        if(!dashboard.classList.contains("hidden")) write(greeting,greetingText,45,430);
      },190);
    }
    const observer = new MutationObserver(onPortalVisibility);
    observer.observe(portal,{attributes:true,attributeFilter:["class"]});
    window.addEventListener("olon:profile-name-changed",event => {
      greetingVersion++;
      const text = "Hola, " + event.detail.name;
      greeting.textContent = text;
      greeting.setAttribute("aria-label",text);
      greeting.classList.remove("cyberTypingActive");
    });
    onPortalVisibility();
    window.addEventListener("pagehide",() => {pending.forEach(id=>window.clearTimeout(id));pending=[];},{once:true});
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",ready,{once:true});
  else ready();
})();
