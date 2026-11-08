import http from 'node:http';
import {readFile, mkdir, writeFile, rename, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArticle} from './public/model.mjs';
import {createRecording} from './local/recordings.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(await readFile(path.join(root,'public/article.json'),'utf8'));
const savedPath = path.join(process.env.READING_DATA_DIR || path.join(root,'.local'),'article.json');
const secondBase = JSON.parse(await readFile(path.join(root,'public/article-02.json'),'utf8'));
const thirdBase = JSON.parse(await readFile(path.join(root,'public/article-03.json'),'utf8'));
async function recordingFolder(file){
  const local=path.join(path.dirname(savedPath),'recordings');
  try{await stat(path.join(local,file));return local;}
  catch(error){if(error.code!=='ENOENT')throw error;return path.join(root,'public/audio/recordings');}
}
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.m4a':'audio/mp4','.svg':'image/svg+xml'};
const port = Number(process.env.PORT || 4173);
let saving = false;
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const second = url.searchParams.get('article')==='02'||pathname==='/article-02.json';
    const third = url.searchParams.get('article')==='03'||pathname==='/article-03.json';
    const selectedBase = third?thirdBase:second?secondBase:base;
    const selectedPath = third?path.join(path.dirname(savedPath),'article-03.json'):second?path.join(path.dirname(savedPath),'article-02.json'):savedPath;
    if(pathname==='/api/base'&&req.method==='GET'){res.writeHead(200,{'Content-Type':types['.json'],'Cache-Control':'no-store'}).end(JSON.stringify(selectedBase));return;}
    if (['/api/article','/article.json','/article-02.json','/article-03.json'].includes(pathname) && req.method === 'GET') {
      let article = selectedBase;
      try { article = validateArticle(JSON.parse(await readFile(selectedPath,'utf8')),selectedBase); } catch (e) { if(e.code !== 'ENOENT') console.error('Saved alignment unavailable:',e.message); }
      res.writeHead(200,{'Content-Type':types['.json'],'Cache-Control':'no-store'}).end(JSON.stringify(article)); return;
    }
    const recordingRoute=/^\/api\/recordings\/((?:s\d{2}|tang-p[1-5]-s\d+|khoo-p[1-7]-s\d+)(?:-[a-f0-9]{8})?)$/.exec(pathname);
    if(recordingRoute&&req.method==='POST'){
      if(![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)){res.writeHead(403).end('Forbidden');return;}
      let current=selectedBase;try{current=validateArticle(JSON.parse(await readFile(selectedPath,'utf8')),selectedBase);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!current.sentences.some(s=>s.id===recordingRoute[1])){res.writeHead(404).end();return;}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>20*1024*1024){res.writeHead(413).end('音檔不可超過 20 MB');return;}chunks.push(chunk);}
      if(!size)throw new Error('錄音沒有內容。');
      const replacement=await createRecording(root,path.dirname(selectedPath),Buffer.concat(chunks),req.headers['content-type']||'application/octet-stream');
      res.writeHead(200,{'Content-Type':types['.json'],'Cache-Control':'no-store'}).end(JSON.stringify(replacement));return;
    }
    if (pathname === '/api/article' && req.method === 'PUT') {
      const origin = req.headers.origin;
      if (!origin || ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(origin) || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end('Forbidden'); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if(Buffer.byteLength(body)>200000) {res.writeHead(413).end('Too large'); return;} }
      const value = validateArticle(JSON.parse(body),selectedBase);
      for(const s of value.sentences)if(s.replacement){if(!s.replacement.src.startsWith('/recordings/'))throw new Error('本機校對只接受本機重錄音源。');const file=path.basename(s.replacement.src);await stat(path.join(await recordingFolder(file),file));}
      if (saving) {res.writeHead(409).end('正在儲存，請稍後再試。');return;}
      saving = true;
      try {
        await mkdir(path.dirname(selectedPath),{recursive:true});
        try {await writeFile(selectedPath+'.backup',await readFile(selectedPath));} catch(e) {if(e.code!=='ENOENT') throw e;}
        await writeFile(selectedPath+'.tmp',JSON.stringify(value,null,2));
        await rename(selectedPath+'.tmp',selectedPath);
      } finally {saving=false;}
      res.writeHead(200,{'Content-Type':types['.json']}).end(JSON.stringify({saved:true})); return;
    }
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
    if(pathname.startsWith('/api/')){res.writeHead(404).end();return;}
    const isRecording=/^\/recordings\/[a-f0-9-]{36}\.m4a$/.test(pathname);
    const localFiles={'/editor':'editor.html','/editor/':'editor.html','/editor.mjs':'editor.mjs','/editor.css':'editor.css'};
    const folder=isRecording?await recordingFolder(path.basename(pathname)):localFiles[pathname]?path.join(root,'local'):pathname.startsWith('/Voice/')?path.join(root,'Voice'):path.join(root,'public');
    const relative=isRecording?path.basename(pathname):localFiles[pathname]|| (pathname.startsWith('/Voice/')?pathname.slice(7):pathname==='/'?'index.html':pathname.slice(1));
    const file = path.resolve(folder,relative);
    if(!file.startsWith(folder+path.sep)) {res.writeHead(403).end();return;}
    const info = await stat(file);
    if(!info.isFile()) {res.writeHead(404).end();return;}
    const headers = {'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    let start=0, end=info.size-1, status=200;
    if(req.headers.range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!match || (!match[1]&&!match[2])) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
      if(!match[1]) start=Math.max(0,info.size-Number(match[2]));
      else {start=Number(match[1]); if(match[2]) end=Math.min(end,Number(match[2]));}
      if(start>end||start>=info.size) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
      status=206; headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length']=end-start+1;
    res.writeHead(status,headers);
    if(req.method==='HEAD') res.end(); else createReadStream(file,{start,end}).pipe(res);
  } catch(e) {res.writeHead(e.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'}).end(e.message);}
});
server.listen(port,'127.0.0.1',()=>console.log(`台語朗讀練習 http://localhost:${port}`));
