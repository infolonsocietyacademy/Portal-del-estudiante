const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const shell = fs.readFileSync('admin-shell.js','utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function workspace({width=1280,user={id:'test-admin',role:'admin',status:'active'},saved}={}) {
  const dom=new JSDOM(source,{url:'https://portal.example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,d=w.document;
  Object.defineProperty(w,'innerWidth',{value:width,writable:true});
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const calls={billing:0,rebates:0,requests:0};
  w.currentUser=user;
  w.isAdminUser=u=>u?.role==='admin';
  w.showPage=id=>d.querySelectorAll('.page').forEach(page=>page.classList.toggle('hidden',page.id!==id));
  w.olonBilling={activate(){calls.billing++;}};
  w.olonRebates={activate(){calls.rebates++;}};
  w.olonRequests={refresh(){calls.requests++;}};
  if(saved)w.sessionStorage.setItem('olon_admin_view_'+user.id,saved);
  d.getElementById('portal').classList.add('admin-mode');
  w.showPage('admin');
  const originalForm=d.getElementById('academyClassForm');
  const originalBilling=d.getElementById('billingNew');
  w.eval(shell);
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  await tick();
  return {dom,w,d,calls,originalForm,originalBilling,close:()=>w.close()};
}
const visibleViews=d=>[...d.querySelectorAll('.olAdminView')].filter(el=>!el.hidden);
const visiblePages=d=>[...d.querySelectorAll('.page')].filter(el=>!el.classList.contains('hidden'));

test('the workspace starts with one overview, one navigation and unchanged form nodes',async()=>{
  const q=await workspace();
  try {
    assert.equal(q.d.querySelectorAll('#olAdminWorkspace').length,1);
    assert.equal(q.d.querySelectorAll('#adminRequestsNavCount').length,1);
    assert.equal(visibleViews(q.d).length,1);
    assert.equal(visibleViews(q.d)[0].dataset.adminView,'adminOverviewBlock');
    assert.ok(q.originalForm);
    assert.equal(q.d.getElementById('academyClassForm'),q.originalForm);
    assert.equal(q.d.getElementById('billingNew'),q.originalBilling);
    assert.equal(q.d.getElementById('olAdminWorkspace').hidden,false);
  } finally {q.close();}
});
test('each internal module shows one view and activates its existing handler',async()=>{
  const q=await workspace();
  try {
    const buttons=[...q.d.querySelectorAll('.olAdminRepoNav [data-admin-open]')].filter(b=>b.dataset.adminOpen);
    for(const button of buttons){
      button.click();await tick();
      assert.equal(visibleViews(q.d).length,1);
      assert.equal(visibleViews(q.d)[0].dataset.adminView,button.dataset.adminOpen);
      assert.equal(visiblePages(q.d).length,1);
      assert.equal(button.getAttribute('aria-current'),'page');
    }
    assert.equal(q.calls.billing,1);assert.equal(q.calls.rebates,1);assert.equal(q.calls.requests,1);
  } finally {q.close();}
});
test('classes, receipts, connections and messages share navigation and return to billing',async()=>{
  const q=await workspace();
  try {
    const sidebar=q.d.getElementById('olAdminSidebar');
    for(const button of q.d.querySelectorAll('.olAdminRepoNav [data-admin-route]')){
      button.click();await tick();
      assert.equal(visiblePages(q.d)[0].id,button.dataset.adminRoute);
      assert.equal(visiblePages(q.d).length,1);
      assert.equal(q.d.getElementById('olAdminSidebar'),sidebar);
      assert.equal(q.d.getElementById('olAdminWorkspace').hidden,false);
      assert.equal(q.d.getElementById('olAdminWorkspaceTitle').textContent,button.querySelector('.olAdminNavName').textContent);
      q.w.olonAdminSections.open('adminBillingBlock');await tick();
      assert.equal(visiblePages(q.d)[0].id,'admin');
      assert.equal(visibleViews(q.d)[0].dataset.adminView,'adminBillingBlock');
    }
  } finally {q.close();}
});
test('navigation filtering, no-results, Escape and Enter work together',async()=>{
  const q=await workspace();
  try {
    const search=q.d.getElementById('olAdminMenuSearch');
    search.value='imposible-zxy';search.dispatchEvent(new q.w.Event('input'));
    assert.equal(q.d.querySelector('.olAdminNoResults').hidden,false);
    assert.equal([...q.d.querySelectorAll('.olAdminNavGroup')].every(x=>x.hidden),true);
    search.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(search.value,'');
    search.value='Licencias';search.dispatchEvent(new q.w.Event('input'));
    assert.equal(q.d.querySelectorAll('.olAdminNavItem:not([hidden])').length,1);
    search.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();
    assert.equal(visibleViews(q.d)[0].dataset.adminView,'olonLicenseAdminBlock');
  } finally {q.close();}
});
test('the mobile menu isolates background focus and ignores height-only Safari resizes',async()=>{
  const q=await workspace({width:390});
  try {
    const side=q.d.getElementById('olAdminSidebar'),main=q.d.getElementById('olAdminMain');
    const toggle=q.d.querySelector('.olAdminMenuToggle');
    assert.equal(side.inert,true);
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'true');
    assert.equal(side.inert,false);assert.equal(main.inert,true);
    q.w.innerHeight=600;q.w.dispatchEvent(new q.w.Event('resize'));
    assert.equal(toggle.getAttribute('aria-expanded'),'true');
    q.d.dispatchEvent(new q.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(toggle.getAttribute('aria-expanded'),'false');
    assert.equal(main.inert,false);assert.equal(side.inert,true);
    assert.equal(q.d.activeElement,toggle);
    q.w.innerWidth=1200;q.w.dispatchEvent(new q.w.Event('resize'));
    assert.equal(side.inert,false);assert.equal(side.hasAttribute('aria-hidden'),false);
  } finally {q.close();}
});
test('leaving administration releases its shell and does not move student pages',async()=>{
  const q=await workspace();
  try {
    const dashboard=q.d.getElementById('dashboard'),parent=dashboard.parentElement;
    q.w.showPage('dashboard');await tick();
    assert.equal(q.d.getElementById('olAdminWorkspace').hidden,true);
    assert.equal(q.d.getElementById('portal').classList.contains('admin-workspace-active'),false);
    assert.equal(dashboard.parentElement,parent);
    q.w.showPage('admin');await tick();
    assert.equal(q.d.getElementById('olAdminWorkspace').hidden,false);
  } finally {q.close();}
});
test('saved section is restored only for its administrator identity',async()=>{
  const q=await workspace({saved:'adminStudentsBlock'});
  try {
    assert.equal(visibleViews(q.d)[0].dataset.adminView,'adminStudentsBlock');
    q.w.showPage('dashboard');await tick();
    q.w.currentUser={id:'another-admin',role:'admin',status:'active'};
    q.w.showPage('admin');await tick();
    assert.equal(visibleViews(q.d)[0].dataset.adminView,'adminOverviewBlock');
  } finally {q.close();}
});
test('non-admin and inactive accounts cannot open modules or trigger handlers',async()=>{
  for(const user of [{id:'student',role:'student',status:'active'},{id:'admin',role:'admin',status:'suspended'},null]){
    const q=await workspace({user});
    try {
      assert.equal(q.w.olonAdminSections.open('adminBillingBlock'),false);
      assert.equal(q.d.getElementById('olAdminWorkspace').hidden,true);
      assert.equal(q.calls.billing,0);
    } finally {q.close();}
  }
});
test('reloading the shell script does not duplicate navigation or move forms again',async()=>{
  const q=await workspace();
  try {
    q.w.eval(shell);await tick();
    assert.equal(q.d.querySelectorAll('#olAdminWorkspace').length,1);
    assert.equal(q.d.querySelectorAll('#olAdminMenuSearch').length,1);
    assert.ok(q.originalForm);
    assert.equal(q.d.getElementById('academyClassForm'),q.originalForm);
  } finally {q.close();}
});
