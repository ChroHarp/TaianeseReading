import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArticle} from '../public/model.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),site=path.join(root,'sites/slow-reading'),output=path.resolve(site,'dist');
if(path.relative(site,output)!=='dist'||!output.startsWith(root))throw new Error('Unsafe deployment output path');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const assets=['index.html','style.css','mobile.css','app.mjs','annotations.mjs','model.mjs','tailo.json','tailo-02.json','tailo-03.json'];
for(const file of assets)await cp(path.join(root,'public',file),path.join(output,file));
await mkdir(path.join(output,'audio/recordings'),{recursive:true});
for(const articleFile of ['article.json','article-02.json','article-03.json']){
  const base=JSON.parse(await readFile(path.join(root,'public',articleFile),'utf8'));
  let value=base;
  try{value=JSON.parse(await readFile(path.join(root,'.local',articleFile),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const article=validateArticle(value,base);
  for(const track of article.tracks){
    await mkdir(path.dirname(path.join(output,track.src)),{recursive:true});
    await cp(path.join(root,'public',track.src),path.join(output,track.src));track.original=track.src;track.waveform=[];
  }
  for(const sentence of article.sentences){
    sentence.note='';
    if(sentence.replacement){
      const file=path.basename(sentence.replacement.src), destination=path.join(output,'audio/recordings',file);
      try{await cp(path.join(root,'.local/recordings',file),destination);}
      catch(error){if(error.code!=='ENOENT')throw error;await cp(path.join(root,'public/audio/recordings',file),destination);}
      sentence.replacement.src='/audio/recordings/'+file;
    }
  }
  await writeFile(path.join(output,articleFile),JSON.stringify(article,null,2));
}
await writeFile(path.join(output,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: microphone=(), camera=()\n');
console.log(`Practice-only deployment built: ${output}`);
