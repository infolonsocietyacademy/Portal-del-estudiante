// OLON Society Academy — public news feed. No private user data.
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"GET,OPTIONS"};
const queries={
 forex:"forex OR USD OR EUR OR currency market when:3d",
 gold:"gold price OR XAUUSD OR bullion market when:3d",
 crypto:"bitcoin OR cryptocurrency market when:3d",
 stocks:"stock market OR Nasdaq OR Wall Street when:3d",
 general:"financial markets OR federal reserve OR economy when:3d",
 noticias:"financial markets OR federal reserve OR economy when:3d"
};
const cache=new Map<string,{until:number,items:unknown[]}>();
function decode(s:string){
 return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
  .replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<")
  .replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/\s+/g," ").trim();
}
function tag(item:string,name:string){
 const match=item.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));
 return match?decode(match[1]):"";
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="GET")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
 try{
  const url=new URL(req.url);
  const category=(url.searchParams.get("category")||"forex").toLowerCase();
  const query=queries[category as keyof typeof queries]||queries.general;
  const cached=cache.get(query);
  if(cached && cached.until>Date.now())return Response.json(cached.items,{headers:{...cors,"Cache-Control":"public,max-age=240"}});
  const feedUrl="https://news.google.com/rss/search?q="+encodeURIComponent(query)+"&hl=es-419&gl=US&ceid=US:es-419";
  const response=await fetch(feedUrl,{signal:AbortSignal.timeout(9000),headers:{"User-Agent":"OLON-Society-Academy-News/1.0"}});
  if(!response.ok)throw Error("El proveedor RSS no respondió.");
  const xml=await response.text();
  const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];
  const entries=blocks.slice(0,24).map(item=>{
   const headline=tag(item,"title").slice(0,250);
   const link=tag(item,"link");
   const summary=tag(item,"description").slice(0,500);
   const parsed=Date.parse(tag(item,"pubDate"));
   const validUrl=link.startsWith("https://news.google.com/")?link:"";
   return {headline,summary,url:validUrl,datetime:Number.isFinite(parsed)?Math.floor(parsed/1000):0,image:""};
  }).filter(x=>x.headline && x.url);
  cache.set(query,{until:Date.now()+4*60_000,items:entries});
  return Response.json(entries,{headers:{...cors,"Cache-Control":"public,max-age=240"}});
 }catch(e){
  return Response.json({error:"No se pudo consultar el proveedor de noticias en este momento."},{status:503,headers:{...cors,"Cache-Control":"no-store"}});
 }
});