import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateArticle,splitSentence,playbackPlan} from '../public/model.mjs';
const base=JSON.parse(await readFile(new URL('../public/article.json',import.meta.url),'utf8'));
test('all manuscript characters and paragraph / recording assignments are preserved',async()=>{
  const text=await readFile(new URL('../manuscript.txt',import.meta.url),'utf8');
  const paragraphs=text.trim().split(/\r?\n\r?\n/).slice(1);
  assert.equal(base.sentences.length,23);
  for(let p=1;p<=8;p++)assert.equal(base.sentences.filter(s=>s.paragraph===p).map(s=>s.text).join(''),paragraphs[p-1]);
  for(const t of base.tracks){assert.deepEqual([...new Set(base.sentences.filter(s=>s.track===t.id).map(s=>s.paragraph))],t.paragraphs);assert.ok(t.waveform.length>0);const audio=await readFile(new URL(`../public${t.src}`,import.meta.url));assert.ok(audio.length>100000);}
  assert.deepEqual(validateArticle(base,base),base);
});
test('reject invalid, overlapping, non-finite, out-of-recording and mismatched edits',()=>{
  for(const change of [s=>s.start=-1,s=>s.end=999,s=>s.end=s.start,s=>s.start=NaN,s=>s.text='',s=>s.id='wrong',s=>s.track=4,s=>s.paragraph=9]){
    const value=structuredClone(base);change(value.sentences[0]);assert.throws(()=>validateArticle(value,base));
  }
  const value=structuredClone(base);value.sentences[1].start=value.sentences[0].end-1;assert.throws(()=>validateArticle(value,base),/重疊/);
});
test('accept corrected text / gap, normalize flags, and ignore imported audio URLs',()=>{
  const value=structuredClone(base);value.sentences[0].text=' 校對過的句子。 ';value.sentences[0].end-=.2;value.sentences[0].reviewed=true;value.tracks[0].src='https://untrusted.invalid';
  const validated=validateArticle(value,base);assert.equal(validated.sentences[0].text,'校對過的句子。');assert.equal(validated.sentences[0].reviewed,true);assert.equal(validated.tracks[0].src,base.tracks[0].src);
});
test('split preserves text, source identity, pronunciation, and adopted audio intervals across reload',async()=>{
  const value=structuredClone(base),source=value.sentences[3],tailo=JSON.parse(await readFile(new URL('../public/tailo.json',import.meta.url),'utf8'));
  source.reviewed=true;source.replacement={src:'/recordings/12345678-1234-1234-1234-123456789abc.m4a',duration:12.672};
  const offset=source.text.indexOf('，')+1;
  const split=validateArticle(splitSentence(value,3,{offset,time:4,id:'s04-deadbeef',tokens:tailo.sentences.s04.tokens}),base);
  const [left,right]=split.sentences.slice(3,5);
  assert.equal(split.sentences.length,24);assert.equal(left.text+right.text,source.text);assert.equal(left.sourceId,'s04');assert.equal(right.sourceId,'s04');
  assert.equal(left.reviewed,false);assert.equal(right.reviewed,false);assert.equal(left.end,right.start);
  assert.equal(left.pronunciation.map(t=>t.text).join(''),left.text);assert.equal(right.pronunciation.map(t=>t.text).join(''),right.text);
  assert.deepEqual([left.replacement.start,left.replacement.end,right.replacement.start,right.replacement.end],[0,4,4,12.672]);
  for(const kind of ['sentence','paragraph','article'])assert.ok(playbackPlan(split,kind,4).some(item=>item.ids.includes('s04-deadbeef')&&item.start===4&&item.end===12.672));
  assert.deepEqual(validateArticle(JSON.parse(JSON.stringify(split)),split),split);
  const repeated=validateArticle(splitSentence(split,4,{offset:right.text.indexOf('，')+1,time:7,id:'s04-cafebabe'}),base);
  assert.equal(repeated.sentences.length,25);assert.equal(repeated.sentences.filter(s=>s.sourceId==='s04').map(s=>s.text).join(''),source.text);
});
test('split rejects blank text, invalid times, broken Unicode, identity tampering, and missing roots',()=>{
  for(const options of [{offset:0,time:5},{offset:5,time:0},{offset:5,time:999}])assert.throws(()=>splitSentence(base,0,{...options,id:'s01-deadbeef'}));
  const special=base.sentences[2].text.indexOf('𤆬');assert.throws(()=>splitSentence(base,2,{offset:special+1,time:20,id:'s03-deadbeef'}));
  const split=splitSentence(base,0,{offset:10,time:5,id:'s01-deadbeef'});
  const missing=structuredClone(split);missing.sentences.splice(2,1);assert.throws(()=>validateArticle(missing,base));
  const duplicate=structuredClone(split);duplicate.sentences[1].id='s01';assert.throws(()=>validateArticle(duplicate,base));
  const wrongSource=structuredClone(split);wrongSource.sentences[1].sourceId='s02';assert.throws(()=>validateArticle(wrongSource,base));
  split.sentences[1].pronunciation=[{text:'wrong',romanization:'wrong'}];assert.throws(()=>validateArticle(split,base));
});
