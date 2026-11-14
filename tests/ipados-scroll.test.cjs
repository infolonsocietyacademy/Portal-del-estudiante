const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const html=fs.readFileSync("index.html","utf8");
const main=fs.readFileSync("script.js","utf8");
const marker="FIX FINAL YTD MOBILE - JS SAFE";
const start=main.indexOf("(function(){",main.indexOf(marker));
const end=main.indexOf("\n})();",start)+6;
const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(([,attrs,code])=>attrs.includes("olon-ipados-scroll-guard")||code.includes(marker))
  .map(([, ,code])=>code);

function harness(){
  const listeners=new Map(),views=[];
  class Element {closest(){return null;}}
  const target=new Element();
  const report=new Element();
  report.closest=selector=>selector==="[data-report]"?report:null;
  report.getAttribute=()=>"monthly";
  const context={
    navigator:{userAgent:"Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)",platform:"iPad",maxTouchPoints:5},
    document:{body:{},readyState:"loading",getElementById:id=>id==="portal"?{classList:{contains:()=>false}}:null,
      querySelector:()=>null,addEventListener:(name,fn)=>{
        if(!listeners.has(name))listeners.set(name,[]);
        listeners.get(name).push(fn);
      }},
    window:{scrollY:0,innerWidth:834,setReportView:view=>views.push(view)},
    Element,getComputedStyle:()=>({overflowY:"visible"}),console
  };
  vm.createContext(context);
  for(const source of [...inline,main.slice(start,end)])vm.runInContext(source,context);
  function send(type,{onReport=false,x=0,y=0}={}){
    const touch={clientX:x,clientY:y};
    let stopped=false;
    const event={type,target:onReport?report:target,cancelable:true,defaultPrevented:false,
      touches:[touch],changedTouches:[touch],preventDefault(){this.defaultPrevented=true;},
      stopPropagation(){},stopImmediatePropagation(){stopped=true;}};
    for(const listener of listeners.get(type)||[]){listener(event);if(stopped)break;}
    return event;
  }
  return {send,views};
}

test("native iPad vertical and horizontal gestures remain available at the top of the portal",()=>{
  for(const gesture of [{y:45},{y:-45},{x:80,y:20}]){
    const h=harness();
    assert.equal(h.send("touchstart").defaultPrevented,false);
    assert.equal(h.send("touchmove",gesture).defaultPrevented,false);
    assert.equal(h.send("touchend",gesture).defaultPrevented,false);
  }
});
test("scrolling from a report button does not cancel the gesture or change reports",()=>{
  const h=harness();
  assert.equal(h.send("pointerdown",{onReport:true}).defaultPrevented,false);
  assert.equal(h.send("touchstart",{onReport:true}).defaultPrevented,false);
  assert.equal(h.send("touchmove",{onReport:true,y:-80}).defaultPrevented,false);
  assert.deepEqual(h.views,[]);
});
test("a report click changes the selected report exactly once",()=>{
  const h=harness();
  h.send("click",{onReport:true});
  assert.deepEqual(h.views,["monthly"]);
});
