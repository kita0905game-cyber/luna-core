import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import {
  knowledgeStatus,
  getActiveConstitution,
  getDocument,
  listDocuments,
  searchDocuments,
  upsertDocument,
  createMemoryCandidate
} from './knowledge-store.js';

const MCP_NAME='luna-core';
const MCP_VERSION='0.1.2';
const toText=(value)=>JSON.stringify(value,null,2);
const ok=(value)=>({content:[{type:'text',text:toText(value)}],structuredContent:value});
const fail=(error)=>({isError:true,content:[{type:'text',text:toText({ok:false,error:error instanceof Error?error.message:'mcp_error'})}]});

function writeEnabled(env){
  return env.LUNA_MCP_WRITE_ENABLED==='true';
}

function createLunaMcpServer(env,{publicOnly=false}={}){
  const server=new McpServer({name:MCP_NAME,version:MCP_VERSION});

  server.registerTool('knowledge_status',{
    description:'Read non-sensitive LUNA CORE canonical D1 knowledge status for connectivity verification.',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>{
    try{return ok({ok:true,status:await knowledgeStatus(env),time:new Date().toISOString()});}
    catch(error){return fail(error);}
  });

  if(publicOnly) return server;

  server.registerTool('get_active_constitution',{
    description:'Read the currently active LUNA Constitution directly from canonical D1.',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>{
    try{
      const document=await getActiveConstitution(env);
      return document?ok({ok:true,document}):fail(new Error('active_constitution_not_found'));
    }catch(error){return fail(error);}
  });

  server.registerTool('list_knowledge_documents',{
    description:'List canonical LUNA knowledge documents directly from D1. Returns metadata, not full bodies.',
    inputSchema:z.object({
      kind:z.enum(['constitution','second_brain','system_spec','bootstrap']).optional(),
      status:z.enum(['draft','active','archived']).optional(),
      limit:z.number().int().min(1).max(100).optional()
    }),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async(args)=>{
    try{return ok({ok:true,documents:await listDocuments(env,args)});}
    catch(error){return fail(error);}
  });

  server.registerTool('search_knowledge',{
    description:'Search canonical LUNA knowledge directly in D1 by text.',
    inputSchema:z.object({
      query:z.string().min(1).max(500),
      kind:z.enum(['constitution','second_brain','system_spec','bootstrap']).optional(),
      limit:z.number().int().min(1).max(50).optional()
    }),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async({query,kind,limit})=>{
    try{return ok({ok:true,query,documents:await searchDocuments(env,query,{kind,limit})});}
    catch(error){return fail(error);}
  });

  server.registerTool('get_knowledge_document',{
    description:'Read one full canonical LUNA knowledge document directly from D1 by document ID.',
    inputSchema:z.object({id:z.string().min(1).max(160)}),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async({id})=>{
    try{
      const document=await getDocument(env,id);
      return document?ok({ok:true,document}):fail(new Error('document_not_found'));
    }catch(error){return fail(error);}
  });

  if(writeEnabled(env)){
    server.registerTool('create_memory_candidate',{
      description:'Create an observing memory candidate in canonical D1. This does not formally promote anything into Second Brain.',
      inputSchema:z.object({
        summary:z.string().min(1).max(4000),
        domain:z.string().min(1).max(120).optional(),
        sourceType:z.enum(['user_statement','luna_analysis','journal','health','study','other']).optional(),
        confidence:z.number().min(0).max(1).optional(),
        evidence:z.array(z.string().max(1000)).max(20).optional(),
        reviewReason:z.string().max(500).optional()
      }),
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
    },async(input)=>{
      try{return ok({ok:true,candidate:await createMemoryCandidate(env,{...input,status:'observing'})});}
      catch(error){return fail(error);}
    });

    server.registerTool('upsert_knowledge_document',{
      description:'Create or update one canonical LUNA knowledge document directly in D1 with mandatory optimistic version checking.',
      inputSchema:z.object({
        id:z.string().min(1).max(160),
        kind:z.enum(['constitution','second_brain','system_spec','bootstrap']),
        title:z.string().min(1).max(240),
        bodyMd:z.string().min(1),
        status:z.enum(['draft','active','archived']),
        expectedVersion:z.number().int().min(0),
        source:z.string().max(120).optional(),
        sourceRef:z.string().max(500).optional(),
        summary:z.string().max(500).optional()
      }),
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async(input)=>{
      try{return ok({ok:true,document:await upsertDocument(env,input,{actor:'chatgpt-mcp'})});}
      catch(error){return fail(error);}
    });
  }

  return server;
}

export async function handleMcpRequest(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname!=='/mcp') return null;

  if(env.LUNA_MCP_ENABLED!=='true'){
    return Response.json({ok:false,error:'luna_mcp_disabled'},{status:503,headers:{'Cache-Control':'no-store'}});
  }

  const authMode=env.LUNA_MCP_AUTH_MODE||'access';
  if(!['none','access'].includes(authMode)){
    return Response.json({ok:false,error:'invalid_mcp_auth_mode'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
  if(authMode==='access'&&!request.headers.get('Cf-Access-Jwt-Assertion')){
    return Response.json({ok:false,error:'cloudflare_access_required'},{status:401,headers:{'Cache-Control':'no-store'}});
  }

  const handler=createMcpHandler(()=>createLunaMcpServer(env,{publicOnly:authMode==='none'}));
  return handler(request,env,ctx);
}
