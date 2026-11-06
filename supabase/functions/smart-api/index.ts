const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

Deno.serve((request: Request) => {
  if(request.method === "OPTIONS") return new Response(null, {status:204, headers});
  return Response.json({error:"Este asistente fue retirado del portal."}, {status:410, headers});
});
