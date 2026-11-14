/* OLFX Admin Workspace: one focused administration view at a time. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const VIEW_IDS = [
    "adminOverviewBlock", "adminStudentsBlock", "adminRequestsBlock",
    "olonLicenseAdminBlock", "olonRankingAdmin", "olonPerformanceBlock",
    "adminBillingBlock", "adminRebatesBlock", "adminReminderBlock", "olonMaintenanceAdminBlock"
  ];
  const MENU = [
    { group:"CENTRO DE CONTROL", id:"adminOverviewBlock", icon:"▦", name:"Resumen ejecutivo", desc:"Actividad y estado" },
    { id:"olonMaintenanceAdminBlock", icon:"⚙", name:"Modo mantenimiento", desc:"Bloquear o abrir el portal" },
    { group:"CONEXIONES DE TRADING", route:"olonOwnAdminPage", icon:"⌁", name:"OLFX CONNECT · MT5", desc:"Emparejar Windows y sincronizar MT5" },
    { group:"GESTIÓN ACADÉMICA", id:"adminStudentsBlock", icon:"♙", name:"Estudiantes", desc:"Directorio y acceso" },
    { id:"adminRequestsBlock", icon:"✓", name:"Solicitudes", desc:"Pendientes de aprobación", counter:"adminRequestsNavCount" },
    { id:"olonLicenseAdminBlock", icon:"◇", name:"Licencias VIP", desc:"Renovación y vencimientos" },
    { route:"academyAdminClassesPage", icon:"▣", name:"Clases", desc:"Programación académica" },
    { group:"FINANZAS Y TRADING", id:"adminBillingBlock", icon:"▤", name:"Facturación", desc:"Cobros y recibos" },
    { id:"adminRebatesBlock", icon:"⇧", name:"Volumen y rebates", desc:"Reportes del bróker" },
    { route:"academyAdminVipPage", icon:"◈", name:"Comprobantes VIP", desc:"Pagos por validar" },
    { id:"olonPerformanceBlock", icon:"▥", name:"Rendimiento", desc:"Estadísticas" },
    { id:"olonRankingAdmin", icon:"★", name:"Ranking TOP 3", desc:"Clasificaciones" },
    { group:"COMUNICACIONES", route:"adminChat", icon:"✉", name:"Mensajes", desc:"Bandeja de entrada", counter:"adminNavUnread" },
    { id:"adminReminderBlock", icon:"◉", name:"Recordatorios", desc:"Avisos y seguimiento" }
  ];

  function isAdmin() {
    return typeof currentUser !== "undefined" && !!currentUser &&
      typeof isAdminUser === "function" && isAdminUser(currentUser) &&
      currentUser.status === "active";
  }

  function init() {
    const admin=$("admin"), nav=admin?.querySelector(".adminWorkspaceNav");
    if(!admin || !nav || admin.querySelector(".olAdminShell")) return;

    const original=Array.from(admin.children);
    const shell=document.createElement("div");
    shell.className="olAdminShell";
    const sidebar=document.createElement("aside");
    sidebar.className="olAdminSidebar";
    sidebar.id="olAdminSidebar";
    sidebar.setAttribute("aria-label","Navegación administrativa");
    const brand=document.createElement("div");
    brand.className="olAdminBrand";
    brand.innerHTML='<span class="olAdminBrandMark" aria-hidden="true">OL</span><span class="olAdminBrandText"><strong>OLON SOCIETY</strong><small>ADMIN / PORTAL DEL TRADER</small></span><span class="olAdminBrandLive" title="Acceso administrativo activo">●</span>';
    const content=document.createElement("main");
    content.className="olAdminMain";
    content.id="olAdminMain";
    const mobileBar=document.createElement("div");
    mobileBar.className="olAdminMobileBar";
    mobileBar.innerHTML='<button type="button" class="olAdminMenuToggle" aria-controls="olAdminSidebar" aria-expanded="false"><span aria-hidden="true">☰</span> Secciones</button><strong id="olAdminMobileTitle">Resumen general</strong>';
    const topbar=document.createElement("header");
    topbar.className="olAdminWorkspaceTopbar";
    topbar.innerHTML='<div class="olAdminWorkspaceHeading"><span>ADMINISTRACIÓN / PORTAL DEL TRADER</span><h2 id="olAdminWorkspaceTitle">Resumen ejecutivo</h2><small id="olAdminWorkspaceMeta">Actividad y estado</small></div><div class="olAdminTopbarAside"><span class="olAdminAccessDot"></span><span>ADMIN ACCESS</span></div>';
    const viewContainer=document.createElement("div");
    viewContainer.className="olAdminViewContainer";
    content.append(mobileBar,topbar,viewContainer);
    const sidebarIntro=document.createElement("div");
    sidebarIntro.className="olAdminSidebarIntro";
    sidebarIntro.innerHTML='<span>ADMINISTRACIÓN</span><strong>Explorador</strong><small>Selecciona un módulo para gestionarlo</small>';
    const finder=document.createElement("div");
    finder.className="olAdminFinder";
    finder.innerHTML='<span aria-hidden="true">⌕</span><input id="olAdminMenuSearch" type="search" placeholder="Filtrar secciones…" autocomplete="off" aria-label="Buscar secciones administrativas" maxlength="80"><kbd>/</kbd>';
    const footer=document.createElement("div");
    footer.className="olAdminSidebarFooter";
    footer.innerHTML='<span>OLON SOCIETY ACADEMY</span><small>SECURE ADMIN WORKSPACE</small>';
    sidebar.append(brand,sidebarIntro,finder,nav,footer);
    shell.append(sidebar,content);

    const backdrop=document.createElement("button");
    backdrop.type="button";
    backdrop.className="olAdminBackdrop";
    backdrop.hidden=true;
    backdrop.setAttribute("aria-label","Cerrar menú administrativo");
    admin.append(shell,backdrop);

    const views=new Map();
    for(const id of VIEW_IDS) {
      const view=document.createElement("div");
      view.className="olAdminView";
      view.dataset.adminView=id;
      view.id="olAdminView-"+id;
      view.setAttribute("role","region");
      view.hidden=true;
      viewContainer.append(view);
      views.set(id,view);
    }
    for(const child of original) {
      if(child===nav) continue;
      const id=child.id;
      let target=views.get(id);
      if(!target) target=views.get("adminOverviewBlock");
      target.append(child);
    }

    // The old quick links repeated the navigation; the sidebar replaces them.
    const quickBar=admin.querySelector(".adminCommandBar");
    if(quickBar)quickBar.hidden=true;

    nav.replaceChildren();
    nav.classList.add("olAdminRepoNav");
    nav.setAttribute("aria-label","Páginas del Centro de Administración");
    const menuButtons=new Map();
    for(const item of MENU) {
      if(item.group) {
        const group=document.createElement("span");
        group.className="olAdminNavGroup";
        group.textContent=item.group;
        nav.append(group);
      }
      const button=document.createElement("button");
      button.type="button";
      button.className="olAdminNavItem olAdminRepoItem";
      button.dataset.adminOpen=item.id||"";
      if(item.route)button.dataset.adminRoute=item.route;
      button.innerHTML='<span class="olAdminNavIcon" aria-hidden="true"></span><span class="olAdminNavLabel"><span class="olAdminNavName"></span><small class="olAdminNavDesc"></small></span><span class="olAdminNavArrow" aria-hidden="true">›</span>';
      button.querySelector(".olAdminNavIcon").textContent=item.icon;
      button.querySelector(".olAdminNavName").textContent=item.name;
      button.querySelector(".olAdminNavDesc").textContent=item.desc||"";
      button.title=item.desc?item.name+" · "+item.desc:item.name;
      if(item.counter) {
        const counter=document.createElement("span");
        counter.className="olAdminNavCounter";
        counter.id=item.counter;
        counter.textContent="0";
        button.append(counter);
      }
      nav.append(button);
      if(item.id)menuButtons.set(item.id,button);
    }

    const searchInput=finder.querySelector("input");
    function filterNavigation(){
      const query=searchInput.value.trim().toLocaleLowerCase("es");
      let any=false;
      for(const button of nav.querySelectorAll(".olAdminNavItem")){
        const match=!query||button.textContent.toLocaleLowerCase("es").includes(query);
        button.hidden=!match;
        if(match)any=true;
      }
      for(const group of nav.querySelectorAll(".olAdminNavGroup")){
        let sibling=group.nextElementSibling,visible=false;
        while(sibling&&!sibling.classList.contains("olAdminNavGroup")){
          if(sibling.classList.contains("olAdminNavItem")&&!sibling.hidden)visible=true;
          sibling=sibling.nextElementSibling;
        }
        group.hidden=!visible;
      }
      finder.classList.toggle("olAdminNoResults",!any);
    }
    searchInput.addEventListener("input",filterNavigation);
    searchInput.addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        const first=nav.querySelector(".olAdminNavItem:not([hidden])");
        if(first){event.preventDefault();first.click();searchInput.blur();}
      }
      if(event.key==="Escape"){searchInput.value="";filterNavigation();searchInput.blur();}
    });
    document.addEventListener("keydown",event=>{
      if(event.key==="/"&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&
        !["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)&&isAdmin()&&!admin.classList.contains("hidden")){
        event.preventDefault();searchInput.focus();
      }
    });
    let selected="adminOverviewBlock";
    const toggle=mobileBar.querySelector(".olAdminMenuToggle");
    function closeMenu() {
      shell.classList.remove("olAdminMenuOpen");
      toggle.setAttribute("aria-expanded","false");
      backdrop.hidden=true;
    }
    function toggleMenu() {
      const opening=!shell.classList.contains("olAdminMenuOpen");
      shell.classList.toggle("olAdminMenuOpen",opening);
      toggle.setAttribute("aria-expanded",String(opening));
      backdrop.hidden=!opening;
    }

    function open(id, options={}) {
      if(!isAdmin() || !views.has(id))return false;
      if(admin.classList.contains("hidden") && typeof window.showPage==="function") {
        const link=document.querySelector('.portalNavLink[data-page="admin"]');
        window.showPage("admin",link);
      }
      selected=id;
      try{if(currentUser?.id)sessionStorage.setItem('olon_admin_view_'+currentUser.id,id);}catch{}
      views.forEach((view,key)=>{view.hidden=key!==id;});
      menuButtons.forEach((button,key)=>{
        const active=key===id;
        button.classList.toggle("active",active);
        if(active)button.setAttribute("aria-current","page");
        else button.removeAttribute("aria-current");
      });
      const label=MENU.find(item=>item.id===id)?.name || "Administración";
      $("olAdminMobileTitle").textContent=label;
      const workspaceTitle=$("olAdminWorkspaceTitle");
      if(workspaceTitle)workspaceTitle.textContent=label;
      const workspaceMeta=$("olAdminWorkspaceMeta");
      if(workspaceMeta)workspaceMeta.textContent=MENU.find(item=>item.id===id)?.desc||"Centro de gestión";
      closeMenu();
      if(options.scroll!==false)admin.scrollIntoView({behavior:"auto",block:"start"});
      if(id==="adminBillingBlock")window.olonBilling?.activate?.();
      if(id==="adminRebatesBlock")window.olonRebates?.activate?.();
      if(id==="adminRequestsBlock")void window.olonRequests?.refresh?.();
      if(id==="olonRankingAdmin")$("olonRankReload")?.click();
      if(id==="olonPerformanceBlock")$("olonPerformanceReload")?.click();
      return true;
    }

    nav.addEventListener("click",event=>{
      const button=event.target.closest("button.olAdminNavItem");
      if(!button)return;
      const id=button.dataset.adminOpen;
      if(id){open(id);return;}
      const route=button.dataset.adminRoute;
      if(!route||!isAdmin())return;
      closeMenu();
      const portalLink=document.querySelector('.portalNavLink[data-page="'+route+'"]');
      if(typeof window.showPage==="function")window.showPage(route,portalLink);
      if(route==="adminChat" && typeof window.loadAdminChatInbox==="function")void window.loadAdminChatInbox();
    });
    toggle.addEventListener("click",toggleMenu);
    backdrop.addEventListener("click",closeMenu);
    document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMenu();});
    window.addEventListener("resize",()=>{if(window.innerWidth>780)closeMenu();});

    window.olonAdminSections={
      open,
      current:()=>selected,
      closeMenu
    };
    // Initialize after login, too: on first DOM load currentUser may not exist yet.
    // Retains the selected admin view and prevents an empty workspace on re-entry.
    let restoredFor=null;
    const ensureAdminView=()=>{
      if(admin.classList.contains("hidden")||!isAdmin())return;
      if(restoredFor!==currentUser.id){
        restoredFor=currentUser.id;
        try{
          const saved=sessionStorage.getItem('olon_admin_view_'+currentUser.id);
          if(views.has(saved))selected=saved;
        }catch{}
      }
      if(views.get(selected)?.hidden)open(selected,{scroll:false});
    };
    new MutationObserver(ensureAdminView).observe(admin,{attributes:true,attributeFilter:["class"]});
    open(selected,{scroll:false});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
