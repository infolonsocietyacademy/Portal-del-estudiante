/* OLFX Admin Workspace: one focused administration view at a time. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const VIEW_IDS = [
    "adminOverviewBlock", "adminStudentsBlock", "adminRequestsBlock",
    "olonLicenseAdminBlock", "olonRankingAdmin", "olonPerformanceBlock",
    "adminBillingBlock", "adminRebatesBlock", "adminReminderBlock"
  ];
  const MENU = [
    { group:"CONTROL", id:"adminOverviewBlock", icon:"▦", name:"Resumen general" },
    { id:"adminStudentsBlock", icon:"♙", name:"Estudiantes" },
    { id:"adminRequestsBlock", icon:"✓", name:"Solicitudes", counter:"adminRequestsNavCount" },
    { id:"olonLicenseAdminBlock", icon:"◇", name:"Licencias VIP" },
    { group:"TRADING Y FINANZAS", id:"olonRankingAdmin", icon:"★", name:"Ranking TOP 3" },
    { id:"olonPerformanceBlock", icon:"▥", name:"Rendimiento" },
    { id:"adminBillingBlock", icon:"▤", name:"Facturación" },
    { id:"adminRebatesBlock", icon:"⇧", name:"Rebates / Excel" },
    { group:"COMUNICACIÓN", route:"academyAdminClassesPage", icon:"▣", name:"Gestionar clases" },
    { route:"academyAdminVipPage", icon:"◈", name:"Comprobantes VIP" },
    { route:"adminChat", icon:"✉", name:"Mensajes", counter:"adminNavUnread" },
    { id:"adminReminderBlock", icon:"◉", name:"Recordatorios" }
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
    brand.innerHTML='<span class="olAdminBrandMark" aria-hidden="true">OL</span><span><strong>OLFX ADMIN</strong><small>CONTROL CENTER / OLON</small></span>';
    const content=document.createElement("main");
    content.className="olAdminMain";
    content.id="olAdminMain";
    const mobileBar=document.createElement("div");
    mobileBar.className="olAdminMobileBar";
    mobileBar.innerHTML='<button type="button" class="olAdminMenuToggle" aria-controls="olAdminSidebar" aria-expanded="false"><span aria-hidden="true">☰</span> Secciones</button><strong id="olAdminMobileTitle">Resumen general</strong>';
    const viewContainer=document.createElement("div");
    viewContainer.className="olAdminViewContainer";
    content.append(mobileBar,viewContainer);
    sidebar.append(brand,nav);
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
      button.className="olAdminNavItem";
      button.dataset.adminOpen=item.id||"";
      if(item.route)button.dataset.adminRoute=item.route;
      button.innerHTML='<span class="olAdminNavIcon" aria-hidden="true"></span><span class="olAdminNavName"></span>';
      button.querySelector(".olAdminNavIcon").textContent=item.icon;
      button.querySelector(".olAdminNavName").textContent=item.name;
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
      views.forEach((view,key)=>{view.hidden=key!==id;});
      menuButtons.forEach((button,key)=>{
        const active=key===id;
        button.classList.toggle("active",active);
        if(active)button.setAttribute("aria-current","page");
        else button.removeAttribute("aria-current");
      });
      const label=MENU.find(item=>item.id===id)?.name || "Administración";
      $("olAdminMobileTitle").textContent=label;
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
    open(selected,{scroll:false});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
