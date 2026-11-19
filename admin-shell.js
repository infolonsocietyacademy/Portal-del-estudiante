/* OLON administration: one shared workspace, using the existing page handlers. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const VIEW_IDS = ["adminOverviewBlock", "adminStudentsBlock", "adminRequestsBlock", "olonLicenseAdminBlock", "olonRankingAdmin", "olonPerformanceBlock", "adminMt5AccountsBlock", "adminBillingBlock", "adminRebatesBlock", "adminReminderBlock", "olonMaintenanceAdminBlock"];
  const MENU = [
    {group:"General",id:"adminOverviewBlock",icon:"overview",name:"Resumen",desc:"Actividad y prioridades de la academia",tab:"overview"},
    {group:"Academia",id:"adminStudentsBlock",icon:"people",name:"Estudiantes",desc:"Directorio, membresías y acceso",tab:"people"},
    {id:"adminRequestsBlock",icon:"requests",name:"Solicitudes",desc:"Revisa los nuevos registros",counter:"adminRequestsNavCount",tab:"people"},
    {id:"olonLicenseAdminBlock",icon:"key",name:"Licencias VIP",desc:"Códigos, renovaciones y vencimientos",tab:"people"},
    {route:"academyAdminClassesPage",icon:"calendar",name:"Clases",desc:"Programa sesiones y administra grabaciones",tab:"overview"},
    {group:"Finanzas",id:"adminBillingBlock",icon:"invoice",name:"Facturación",desc:"Facturas, pagos y cuentas por cobrar",tab:"finance"},
    {id:"adminRebatesBlock",icon:"chart",name:"Volumen y rebates",desc:"Importa y consulta los reportes del bróker",tab:"finance"},
    {route:"academyAdminVipPage",icon:"receipt",name:"Comprobantes VIP",desc:"Revisa los comprobantes de membresía",tab:"finance"},
    {group:"Trading",id:"adminMt5AccountsBlock",icon:"connect",name:"Cuentas MT5",desc:"Identifica al dueño de cada cuenta y revisa su conexión",tab:"trading"},
    {route:"copyTradePage",icon:"connect",name:"Copy Trade",desc:"Una maestra y tus cuentas receptoras · piloto",tab:"trading"},
    {route:"olonOwnAdminPage",icon:"connect",name:"OLFX CONNECT",desc:"Equipos y sincronización de cuentas MT5",tab:"trading"},
    {id:"olonPerformanceBlock",icon:"pulse",name:"Rendimiento",desc:"Resultados de los traders por período",tab:"trading"},
    {id:"olonRankingAdmin",icon:"star",name:"Ranking",desc:"Clasificaciones semanales, mensuales y anuales",tab:"trading"},
    {group:"Comunicación",route:"adminChat",icon:"message",name:"Mensajes",desc:"Conversaciones privadas con estudiantes",counter:"adminNavUnread",tab:"overview"},
    {id:"adminReminderBlock",icon:"bell",name:"Recordatorios",desc:"Publica avisos y da seguimiento",tab:"overview"},
    {group:"Sistema",id:"olonMaintenanceAdminBlock",icon:"settings",name:"Mantenimiento",desc:"Controla la disponibilidad del portal",tab:"settings"}
  ];
  const PATHS = {
    overview:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><path d="M3 14h7v7H3zM14 14h7v7h-7z"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
    requests:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    key:'<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-6 0 3-3"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/>',
    invoice:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/>',
    chart:'<path d="M3 3v18h18M7 15l4-5 4 3 6-7"/>',
    receipt:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-13 5h4"/>',
    connect:'<rect x="3" y="3" width="18" height="12" rx="2"/><path d="M8 21h8m-4-6v6m-5-12 3-3m4 6 3-3"/>',
    pulse:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    star:'<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>',
    message:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V6a3 3 0 0 1 3-3h7a8 8 0 0 1 8 8Z"/><path d="M7 8h10M7 12h7"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    settings:'<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+PATHS[name]+'</svg>';
  function isAdmin() {
    return typeof currentUser !== "undefined" && !!currentUser && typeof isAdminUser === "function" && isAdminUser(currentUser) && currentUser.status === "active";
  }
  function init() {
    const admin=$("admin"), portal=$("portal"), nav=admin?.querySelector(".adminWorkspaceNav");
    if(!admin || !portal || !nav || $("olAdminWorkspace"))return;
    const original=Array.from(admin.children);
    const shell=document.createElement("div");
    shell.id="olAdminWorkspace";
    shell.className="olAdminShell";
    shell.hidden=true;
    admin.before(shell);
    const repo=document.createElement("header");
    repo.className="olAdminRepositoryHeader";
    repo.innerHTML='<div class="olAdminRepositoryIdentity"><span class="olAdminRepositoryMark" aria-hidden="true">OL</span><span class="olAdminRepositoryOwner">olon-society</span><span class="olAdminRepositorySlash">/</span><strong>Administración</strong><span class="olAdminPrivateBadge">'+icon("lock")+'Privado</span></div><nav class="olAdminRepositoryTabs" aria-label="Accesos de administración"></nav>';
    const tabs=[
      {name:"Resumen",id:"adminOverviewBlock",icon:"overview",key:"overview"},
      {name:"Estudiantes",id:"adminStudentsBlock",icon:"people",key:"people"},
      {name:"Finanzas",id:"adminBillingBlock",icon:"invoice",key:"finance"},
      {name:"Trading",route:"olonOwnAdminPage",icon:"pulse",key:"trading"},
      {name:"Sistema",id:"olonMaintenanceAdminBlock",icon:"settings",key:"settings"}
    ];
    for(const tab of tabs){
      const button=document.createElement("button");
      button.type="button";
      button.className="olAdminRepositoryTab";
      button.dataset.adminOpen=tab.id||"";
      if(tab.route)button.dataset.adminRoute=tab.route;
      button.dataset.adminTab=tab.key;
      button.innerHTML=icon(tab.icon)+'<span>'+tab.name+'</span>';
      repo.querySelector("nav").append(button);
    }
    const sidebar=document.createElement("aside");
    sidebar.className="olAdminSidebar";
    sidebar.id="olAdminSidebar";
    sidebar.setAttribute("aria-label","Navegación administrativa");
    sidebar.innerHTML='<div class="olAdminSidebarHeading"><strong>Administración</strong><button type="button" class="olAdminCloseMenu" aria-label="Cerrar menú administrativo">'+icon("close")+'</button></div>';
    const finder=document.createElement("div");
    finder.className="olAdminFinder";
    finder.innerHTML=icon("search")+'<input id="olAdminMenuSearch" type="search" placeholder="Buscar sección…" autocomplete="off" aria-label="Buscar secciones administrativas" maxlength="80"><kbd>/</kbd>';
    const empty=document.createElement("p");
    empty.className="olAdminNoResults";
    empty.textContent="No se encontraron secciones.";
    empty.setAttribute("role","status");
    empty.hidden=true;
    const footer=document.createElement("div");
    footer.className="olAdminSidebarFooter";
    footer.innerHTML='<strong>OLON Society Academy</strong><span>Portal del Trader</span>';
    sidebar.append(finder,nav,empty,footer);
    const content=document.createElement("div");
    content.className="olAdminMain";
    content.id="olAdminMain";
    const mobileBar=document.createElement("div");
    mobileBar.className="olAdminMobileBar";
    mobileBar.innerHTML='<button type="button" class="olAdminMenuToggle" aria-controls="olAdminSidebar" aria-expanded="false">'+icon("menu")+'<span>Secciones</span></button><span id="olAdminMobileTitle">Resumen</span>';
    const topbar=document.createElement("div");
    topbar.className="olAdminWorkspaceTopbar";
    topbar.innerHTML='<div class="olAdminWorkspaceHeading"><span class="olAdminBreadcrumb">Administración <span aria-hidden="true">/</span> <span id="olAdminBreadcrumbCurrent">Resumen</span></span><h2 id="olAdminWorkspaceTitle" tabindex="-1">Resumen</h2><p id="olAdminWorkspaceMeta">Actividad y prioridades de la academia</p></div>';
    const pageHost=document.createElement("div");
    pageHost.className="olAdminPageHost";
    content.append(mobileBar,topbar,pageHost);
    const backdrop=document.createElement("button");
    backdrop.type="button";
    backdrop.className="olAdminBackdrop";
    backdrop.hidden=true;
    backdrop.tabIndex=-1;
    backdrop.setAttribute("aria-label","Cerrar menú administrativo");
    shell.append(repo,sidebar,content,backdrop);
    const viewContainer=document.createElement("div");
    viewContainer.className="olAdminViewContainer";
    const views=new Map();
    for(const id of VIEW_IDS){
      const view=document.createElement("div");
      view.className="olAdminView";
      view.dataset.adminView=id;
      view.id="olAdminView-"+id;
      view.setAttribute("role","region");
      view.setAttribute("aria-label",MENU.find(item=>item.id===id)?.name||"Administración");
      view.hidden=true;
      viewContainer.append(view);
      views.set(id,view);
    }
    for(const child of original){
      if(child===nav)continue;
      (views.get(child.id)||views.get("adminOverviewBlock")).append(child);
    }
    admin.replaceChildren(viewContainer);
    pageHost.append(admin);
    const routePages=MENU.filter(item=>item.route).map(item=>$(item.route)).filter(Boolean);
    const sharedCopyPage=$("copyTradePage"),sharedCopyParent=sharedCopyPage?.parentNode;
    for(const page of routePages)pageHost.append(page);
    admin.querySelector(".adminCommandBar")?.setAttribute("hidden","");
    nav.replaceChildren();
    nav.className="adminWorkspaceNav olAdminRepoNav";
    nav.setAttribute("aria-label","Secciones administrativas");
    const menuButtons=new Map();
    for(const item of MENU){
      if(item.group){
        const group=document.createElement("span");
        group.className="olAdminNavGroup";
        group.textContent=item.group;
        nav.append(group);
      }
      const button=document.createElement("button");
      button.type="button";
      button.className="olAdminNavItem";
      button.dataset.adminOpen=item.id||"";
      if(item.route)button.dataset.adminRoute=item.route;
      button.innerHTML='<span class="olAdminNavIcon">'+icon(item.icon)+'</span><span class="olAdminNavName">'+item.name+'</span>';
      button.title=item.desc;
      if(item.counter){
        const count=document.createElement("span");
        count.className="olAdminNavCounter";
        count.id=item.counter;
        count.textContent="0";
        button.append(count);
      }
      nav.append(button);
      menuButtons.set(item.id||item.route,button);
    }
    const search=finder.querySelector("input");
    function filterNavigation(){
      const query=search.value.trim().toLocaleLowerCase("es");
      let any=false;
      menuButtons.forEach(button=>{
        button.hidden=!!query&&!button.textContent.toLocaleLowerCase("es").includes(query);
        if(!button.hidden)any=true;
      });
      for(const group of nav.querySelectorAll(".olAdminNavGroup")){
        let sibling=group.nextElementSibling,visible=false;
        while(sibling&&!sibling.classList.contains("olAdminNavGroup")){
          if(!sibling.hidden)visible=true;
          sibling=sibling.nextElementSibling;
        }
        group.hidden=!visible;
      }
      empty.hidden=any;
    }
    search.addEventListener("input",filterNavigation);
    search.addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        const first=nav.querySelector(".olAdminNavItem:not([hidden])");
        if(first){event.preventDefault();first.click();search.blur();}
      }
      if(event.key==="Escape"){search.value="";filterNavigation();}
    });
    let selected="adminOverviewBlock",restoredFor=null;
    const toggle=mobileBar.querySelector("button");
    const mobile=()=>window.innerWidth<=900;
    function setMenu(opening,restoreFocus=false){
      opening=opening&&mobile();
      shell.classList.toggle("olAdminMenuOpen",opening);
      toggle.setAttribute("aria-expanded",String(opening));
      backdrop.hidden=!opening;
      sidebar.inert=mobile()&&!opening;
      if(mobile())sidebar.setAttribute("aria-hidden",String(!opening));
      else sidebar.removeAttribute("aria-hidden");
      content.inert=opening;
      repo.inert=opening;
      if(opening)sidebar.querySelector(".olAdminCloseMenu").focus();
      else if(restoreFocus&&mobile())toggle.focus();
    }
    function closeMenu(restoreFocus=false){setMenu(false,restoreFocus);}
    function select(item){
      const key=item.id||item.route;
      menuButtons.forEach((button,id)=>{
        button.classList.toggle("active",id===key);
        if(id===key)button.setAttribute("aria-current","page");
        else button.removeAttribute("aria-current");
      });
      for(const button of repo.querySelectorAll(".olAdminRepositoryTab")){
        const active=button.dataset.adminTab===item.tab;
        button.classList.toggle("active",active);
        if(active)button.setAttribute("aria-current","page");
        else button.removeAttribute("aria-current");
      }
      $("olAdminWorkspaceTitle").textContent=item.name;
      $("olAdminWorkspaceMeta").textContent=item.desc;
      $("olAdminBreadcrumbCurrent").textContent=item.name;
      $("olAdminMobileTitle").textContent=item.name;
    }
    function open(id,options={}){
      if(!isAdmin()||!views.has(id))return false;
      if(admin.classList.contains("hidden")&&typeof window.showPage==="function"){
        window.showPage("admin",document.querySelector('.portalNavLink[data-page="admin"]'));
      }
      selected=id;
      try{sessionStorage.setItem("olon_admin_view_"+currentUser.id,id);}catch{}
      views.forEach((view,key)=>{view.hidden=key!==id;});
      select(MENU.find(item=>item.id===id));
      closeMenu();
      if(options.scroll!==false)shell.scrollIntoView({behavior:"auto",block:"start"});
      if(options.focus)$("olAdminWorkspaceTitle").focus({preventScroll:true});
      if(id==="adminMt5AccountsBlock")void window.olonAdminMt5?.activate?.();
      if(id==="adminBillingBlock")window.olonBilling?.activate?.();
      if(id==="adminRebatesBlock")window.olonRebates?.activate?.();
      if(id==="adminRequestsBlock")void window.olonRequests?.refresh?.();
      if(id==="olonRankingAdmin")$("olonRankReload")?.click();
      if(id==="olonPerformanceBlock")$("olonPerformanceReload")?.click();
      return true;
    }
    shell.addEventListener("click",event=>{
      const button=event.target.closest("[data-admin-open],[data-admin-route]");
      if(!button||!isAdmin())return;
      if(button.dataset.adminOpen){open(button.dataset.adminOpen,{focus:true});return;}
      const route=button.dataset.adminRoute;
      if(!route||!routePages.some(page=>page.id===route))return;
      closeMenu();
      if(typeof window.showPage==="function")window.showPage(route,document.querySelector('.portalNavLink[data-page="'+route+'"]'));
      select(MENU.find(item=>item.route===route));
      shell.scrollIntoView({behavior:"auto",block:"start"});
      $("olAdminWorkspaceTitle").focus({preventScroll:true});
    });
    toggle.addEventListener("click",()=>setMenu(!shell.classList.contains("olAdminMenuOpen")));
    sidebar.querySelector(".olAdminCloseMenu").addEventListener("click",()=>closeMenu(true));
    backdrop.addEventListener("click",()=>closeMenu(true));
    document.addEventListener("keydown",event=>{
      if(shell.hidden||!isAdmin())return;
      if(event.key==="Escape"&&shell.classList.contains("olAdminMenuOpen")){event.preventDefault();closeMenu(true);}
      if(event.key==="/"&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)&&!document.activeElement?.isContentEditable){
        event.preventDefault();if(mobile())setMenu(true);search.focus();
      }
      if(event.key==="Tab"&&shell.classList.contains("olAdminMenuOpen")){
        const focusable=[...sidebar.querySelectorAll("button,input")].filter(el=>!el.hidden&&!el.closest("[hidden]")&&!el.disabled);
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    let previousWidth=window.innerWidth;
    window.addEventListener("resize",()=>{
      if(window.innerWidth===previousWidth)return;
      previousWidth=window.innerWidth;
      closeMenu();
    },{passive:true});
    function ensureWorkspace(){
      // Copy Trade is shared with the student's private workspace.
      if(sharedCopyPage){
        const parent=isAdmin()?pageHost:sharedCopyParent;
        if(parent&&sharedCopyPage.parentNode!==parent)parent.append(sharedCopyPage);
      }
      const visible=[admin,...routePages].find(page=>!page.classList.contains("hidden"));
      const active=!!visible&&isAdmin();
      shell.hidden=!active;
      if(portal.classList.contains("admin-workspace-active")!==active)portal.classList.toggle("admin-workspace-active",active);
      if(!active){closeMenu();return;}
      if(visible===admin){
        if(restoredFor!==currentUser.id){
          restoredFor=currentUser.id;
          selected="adminOverviewBlock";
          try{const saved=sessionStorage.getItem("olon_admin_view_"+currentUser.id);if(views.has(saved))selected=saved;}catch{}
        }
        if(views.get(selected).hidden)open(selected,{scroll:false});
        else select(MENU.find(item=>item.id===selected));
      }else select(MENU.find(item=>item.route===visible.id));
    }
    const observer=new MutationObserver(ensureWorkspace);
    for(const page of [admin,...routePages])observer.observe(page,{attributes:true,attributeFilter:["class"]});
    observer.observe(portal,{attributes:true,attributeFilter:["class"]});
    window.olonAdminSections={open,current:()=>selected,closeMenu};
    setMenu(false);
    ensureWorkspace();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
