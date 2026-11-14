const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const html=fs.readFileSync("index.html","utf8");
const snippet=html.match(/<script id="olon-ipados-scroll-guard">([\s\S]*?)<\/script>/)?.[1];
assert.ok(snippet,"iPad touch guard must be present");

function harness({ipad=true,portalOpen=true}={}){
  const listeners={};
  const portal={classList:{contains:name=>name==="hidden"&&!portalOpen}};
  let prevented=0;
  const context={
    navigator:{userAgent:ipad?"Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)":"Mozilla/5.0 (X11; Linux x86_64)",platform:ipad?"iPad":"Linux",maxTouchPoints:ipad?5:0},
    document:{body:{},getElementById:id=>id==="portal"?portal:null,
      addEventListener:(name,fn,options)=>{listeners[name]={fn,options};}},
    window:{scrollY:0},
    Element:class Element{},
    getComputedStyle:()=>({overflowY:"visible"})
  };
  vm.runInNewContext(snippet,context);
  function move({y=30,x=0,cancelable=true}={}){
    if(!listeners.touchstart)return false;
    const target={};
    const touch=(clientX,clientY)=>({clientX,clientY});
    listeners.touchstart.fn({touches:[touch(0,0)],target});
    listeners.touchmove.fn({touches:[touch(x,y)],cancelable,target,preventDefault(){prevented++;}});
    return prevented>0;
  }
  return {listeners,move,scroll:y=>{context.window.scrollY=y;},get prevented(){return prevented;}};
}

test("iPad Safari pull-down on authenticated portal prevents default refresh",()=>{
  const h=harness();assert.equal(h.listeners.touchmove.options.passive,false);
  assert.equal(h.move({y:45}),true);
});
test("normal downward page scrolling and horizontal gestures remain available",()=>{
  const h=harness();h.scroll(140);
  assert.equal(h.move({y:45}),false);h.scroll(0);
  assert.equal(h.move({y:-50}),false);
  assert.equal(h.move({y:20,x:80}),false);
});
test("public login and non-iPad browsers are unaffected",()=>{
  assert.equal(harness({portalOpen:false}).move({y:40}),false);
  assert.equal(harness({ipad:false}).listeners.touchmove,undefined);
});
