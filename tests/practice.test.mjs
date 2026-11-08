import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {playbackPlan,validateArticle} from '../public/model.mjs';
import {createHash} from 'node:crypto';
const base=JSON.parse(await readFile(new URL('../public/article.json',import.meta.url),'utf8'));
test('adopted recordings are shipped byte-for-byte and selected in all playback modes',async()=>{
  let saved=base;
  try{saved=JSON.parse(await readFile(new URL('../.local/article.json',import.meta.url),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const deployed=JSON.parse(await readFile(new URL('../sites/slow-reading/dist/article.json',import.meta.url),'utf8'));
  assert.equal(deployed.sentences.length,saved.sentences.length);
  for(const[index,s]of saved.sentences.entries())for(const field of ['id','sourceId','text','start','end','reviewed','pronunciation','romanization'])assert.deepEqual(deployed.sentences[index][field],s[field],`${s.id}: ${field} changed during packaging`);
  for(const [index,s]of saved.sentences.entries())if(s.replacement){
    const shipped=deployed.sentences[index].replacement;assert.ok(shipped,`${s.id} replacement missing`);assert.equal(shipped.duration,s.replacement.duration);
    assert.equal(shipped.start,s.replacement.start);assert.equal(shipped.end,s.replacement.end);
    const hash=data=>createHash('sha256').update(data).digest('hex');
    assert.equal(hash(await readFile(new URL('../.local'+s.replacement.src,import.meta.url))),hash(await readFile(new URL('../sites/slow-reading/dist'+shipped.src,import.meta.url))));
    for(const kind of ['sentence','paragraph','article'])assert.ok(playbackPlan(deployed,kind,index).some(item=>item.src===shipped.src&&item.replacement));
  }
});
test('word-level Tai-lo preserves all characters and includes the corrected tshua',async()=>{
  const data=JSON.parse(await readFile(new URL('../public/tailo.json',import.meta.url),'utf8'));
  assert.deepEqual(data.missing,[]);
  for(const s of base.sentences){assert.equal(data.sentences[s.id].tokens.map(t=>t.text).join(''),s.text);}
  assert.ok(data.sentences.s03.tokens.some(t=>t.text==='𤆬'&&t.romanization==='tshuā'));
  assert.match(base.sentences.find(s=>s.id==='s20').text,/擲挕捒矣/);
  assert.doesNotMatch(base.sentences.map(s=>s.text).join(''),/擲挕捒抨|擲挕捒去/);
});
test('replacement is used for sentence, paragraph and full article; original stays available',()=>{
  const value=structuredClone(base),s=value.sentences[1];s.replacement={src:'/recordings/12345678-1234-1234-1234-123456789abc.m4a',duration:2};
  const a=validateArticle(value,base);
  for(const kind of ['sentence','paragraph','article'])assert.ok(playbackPlan(a,kind,1).some(item=>item.replacement&&item.src===s.replacement.src&&item.start===0&&item.end===2));
  const plan=playbackPlan(a,'article',1),replacementIndex=plan.findIndex(item=>item.replacement);
  assert.equal(plan[replacementIndex-1].end,s.start);assert.equal(plan[replacementIndex+1].start,s.end);
  assert.ok(playbackPlan(a,'sentence',1,'original').every(item=>!item.replacement));
  assert.equal(playbackPlan(base,'article').length,4);
  for(const bad of ['https://example.com/a.m4a','/recordings/../../secret','/editor.mjs']){a.sentences[1].replacement.src=bad;assert.throws(()=>validateArticle(a,base));}
});
test('deployment is static practice only, without editor, original uploads, APIs or notes',async()=>{
  const root=new URL('../sites/slow-reading/dist/',import.meta.url),files=await readdir(root);
  for(const file of ['editor.html','editor.mjs','server.mjs','Voice','sources','local'])assert.ok(!files.includes(file));
  const html=await readFile(new URL('index.html',root),'utf8');assert.doesNotMatch(html,/id="editor"|startRecord|saveProject|editMode/);
  const a=JSON.parse(await readFile(new URL('article.json',root),'utf8'));
  assert.ok(a.sentences.every(s=>!s.note));assert.ok(a.tracks.every(t=>t.original===t.src&&t.waveform.length===0));
  assert.match(html,/showTailo/);assert.match(html,/markerMode/);
});

test('second article audio, Tai-lo and deployment retain all five corrected paragraphs',async()=>{
  const article=JSON.parse(await readFile(new URL('../public/article-02.json',import.meta.url),'utf8'));
  const deployed=JSON.parse(await readFile(new URL('../sites/slow-reading/dist/article-02.json',import.meta.url),'utf8'));
  const tailo=JSON.parse(await readFile(new URL('../public/tailo-02.json',import.meta.url),'utf8'));
  assert.equal(article.textOnly,undefined);assert.equal(article.sentences.length,22);
  assert.equal(article.sentences.map(s=>s.text).join(''),article.paragraphs.join(''));
  assert.ok(article.paragraphs[3].includes('看伊咧耍𨑨迌物仔'));
  assert.deepEqual(tailo.missing,[]);validateArticle(article,article);
  for(const s of article.sentences){assert.equal(tailo.sentences[s.id].tokens.map(t=>t.text).join(''),s.text);assert.equal(s.reviewed,false);}
  assert.deepEqual(article.tracks.map(t=>t.paragraphs),[[1,2],[3],[4,5]]);
  for(const kind of ['sentence','paragraph','article'])for(let i=0;i<article.sentences.length;i++){
    const plan=playbackPlan(deployed,kind,i);assert.ok(plan.length);
    for(const item of plan){assert.ok(item.start>=0&&item.end>item.start&&item.end<=item.duration);await readFile(new URL('../sites/slow-reading/dist'+item.src,import.meta.url));}
  }
  for(const track of deployed.tracks){assert.equal(track.original,track.src);assert.deepEqual(track.waveform,[]);}
});

test('realigned second article keeps saved title and splits and rejects stale timings',async()=>{
  const base=JSON.parse(await readFile(new URL('../public/article-02.json',import.meta.url),'utf8'));
  const deployed=JSON.parse(await readFile(new URL('../sites/slow-reading/dist/article-02.json',import.meta.url),'utf8'));
  assert.ok(base.alignmentRevision);validateArticle(deployed,base);
  const stale=structuredClone(deployed);delete stale.alignmentRevision;
  assert.throws(()=>validateArticle(stale,base),/句界版本已更新/);
  const roots=base.sentences.map(s=>s.id);
  assert.deepEqual([...new Set(deployed.sentences.map(s=>s.sourceId||s.id))],roots);
  for(const track of deployed.tracks){
    const sentences=deployed.sentences.filter(s=>s.track===track.id);
    for(let i=1;i<sentences.length;i++)assert.equal(sentences[i-1].end,sentences[i].start,'no omitted interval between sentences');
    assert.deepEqual(playbackPlan(deployed,'article').filter(item=>item.track===track.id).flatMap(item=>item.ids),sentences.map(s=>s.id));
  }
});
