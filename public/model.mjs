export function validateArticle(value, base) {
  if(base.alignmentRevision&&value?.alignmentRevision!==base.alignmentRevision)throw new Error('句界版本已更新，請重新整理頁面後再修改或儲存。');
  if (!value || value.schemaVersion !== 1 || value.id !== base.id || !Array.isArray(value.sentences) || !value.sentences.length || value.sentences.length>1000) throw new Error('校對檔格式或句數不符合這篇文章。');
  const clean = structuredClone(base);
  const roots=new Map();
  for(const s of base.sentences)if(!roots.has(s.sourceId||s.id))roots.set(s.sourceId||s.id,s);
  const rootOrder=[...roots.keys()],seen=new Set();let rootIndex=-1;
  let previous = null;
  clean.sentences = value.sentences.map((s, i) => {
    const root=s.sourceId||s.id,original=roots.get(root),position=rootOrder.indexOf(root);
    if(!original||seen.has(s.id)||typeof s.id!=='string'||(s.id!==root&&!new RegExp(`^${root}-[a-f0-9]{8}$`).test(s.id))||s.track!==original.track||s.paragraph!==original.paragraph||position<rootIndex||position>rootIndex+1)throw new Error(`第 ${i+1} 句的識別資料或順序不符合。`);
    if(position!==rootIndex&&s.id!==root)throw new Error('每組分句須保留原句識別。');
    rootIndex=position;seen.add(s.id);
    const duration = base.tracks.find(t => t.id === s.track).duration;
    if (typeof s.text !== 'string' || !s.text.trim() || s.text.length > 2000 || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end > duration + .001 || s.end - s.start < .1) throw new Error(`第 ${i+1} 句的文字或時間無效，請檢查錄音範圍。`);
    if (previous?.track === s.track && s.start < previous.end - .001) throw new Error(`第 ${i+1} 句與前一句重疊。請先調整相鄰句界。`);
    previous = s;
    const result = {...original,id:s.id,text:s.sourceId?s.text:s.text.trim(), start:s.start, end:s.end, reviewed:s.reviewed === true, note:typeof s.note === 'string' ? s.note.slice(0,2000) : ''};
    if(s.sourceId||s.id!==root)result.sourceId=root;
    delete result.replacement;
    delete result.pronunciation;
    delete result.romanization;
    if(s.pronunciation!==undefined){
      if(!Array.isArray(s.pronunciation)||s.pronunciation.length>2000||s.pronunciation.some(t=>!t||typeof t.text!=='string'||!t.text||!(t.romanization===null||typeof t.romanization==='string'&&t.romanization.length<500))||s.pronunciation.map(t=>t.text).join('')!==result.text)throw new Error(`第 ${i+1} 句的逐詞台羅不符合稿文。`);
      result.pronunciation=s.pronunciation.map(t=>({text:t.text,romanization:t.romanization}));
    }
    if(s.romanization !== undefined) {
      if(typeof s.romanization!=='string'||s.romanization.length>4000)throw new Error(`第 ${i+1} 句的台羅格式不正確。`);
      result.romanization=s.romanization;
    }
    if(s.replacement) {
      const r=s.replacement;
      if(typeof r.src!=='string'||!/^\/(?:audio\/)?recordings\/[a-f0-9-]{36}\.m4a$/.test(r.src)||!Number.isFinite(r.duration)||r.duration<.1||r.duration>180)throw new Error(`第 ${i+1} 句的重錄音源不正確。`);
      result.replacement={src:r.src,duration:r.duration};
      if(r.start!==undefined||r.end!==undefined){
        if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end>r.duration+.001||r.end-r.start<.1)throw new Error('重錄音源的分割範圍無效。');
        Object.assign(result.replacement,{start:r.start,end:r.end});
      }
    }
    return result;
  });
  if(rootIndex!==rootOrder.length-1)throw new Error('缺少原稿句子，請勿刪除整組分句。');
  return clean;
}
export function playbackPlan(article, kind, index=0, version='normalized') {
  const selected=article.sentences[index];
  if(kind==='source') {
    const t=article.tracks.find(t=>t.id===selected.track);
    return [{track:t.id,src:version==='original'?t.original:t.src,start:0,end:t.duration,duration:t.duration,ids:article.sentences.filter(s=>s.track===t.id).map(s=>s.id)}];
  }
  const sentences=kind==='article'?article.sentences:kind==='paragraph'?article.sentences.filter(s=>s.paragraph===selected.paragraph):[selected];
  const plan=[];
  for(const s of sentences) {
    const t=article.tracks.find(t=>t.id===s.track), replacement=version!=='original'&&s.replacement;
    const item=replacement?{track:s.track,src:replacement.src,start:replacement.start??0,end:replacement.end??replacement.duration,duration:replacement.duration,ids:[s.id],replacement:true}:{track:s.track,src:version==='original'?t.original:t.src,start:s.start,end:s.end,duration:t.duration,ids:[s.id]};
    const previous=plan.at(-1);
    if(previous&&!previous.replacement&&!item.replacement&&previous.src===item.src&&Math.abs(previous.end-item.start)<.001){previous.end=item.end;previous.ids.push(s.id);}else plan.push(item);
  }
  return plan;
}
export function splitSentence(article,index,{offset,time,id,tokens,leftRomanization='',rightRomanization=''}){
  const s=article.sentences[index];
  if(!s||!Number.isInteger(offset)||offset<=0||offset>=s.text.length||!s.text.slice(0,offset).trim()||!s.text.slice(offset).trim()||(/[\uD800-\uDBFF]/.test(s.text[offset-1])&&/[\uDC00-\uDFFF]/.test(s.text[offset])))throw new Error('請把文字游標放在兩段文字之間。');
  const root=s.sourceId||s.id;
  if(!new RegExp(`^${root}-[a-f0-9]{8}$`).test(id)||article.sentences.some(x=>x.id===id))throw new Error('分句識別重複或不正確。');
  const r=s.replacement,start=r?(r.start??0):s.start,end=r?(r.end??r.duration):s.end;
  if(!Number.isFinite(time)||time-start<.1||end-time<.1)throw new Error('分割時間須在此句內，前後至少各留 0.1 秒。');
  if(s.romanization&&(!leftRomanization.trim()||!rightRomanization.trim()))throw new Error('這句有整句台羅修訂，請分別填寫前句與後句的台羅。');
  const originalCut=r?s.start+(s.end-s.start)*(time-start)/(end-start):time;
  const left={...s,sourceId:root,text:s.text.slice(0,offset),end:originalCut,reviewed:false,romanization:leftRomanization},right={...s,id,sourceId:root,text:s.text.slice(offset),start:originalCut,reviewed:false,romanization:rightRomanization};
  delete left.pronunciation;delete right.pronunciation;
  if(r){left.replacement={...r,start,end:time};right.replacement={...r,start:time,end};}
  const source=tokens||s.pronunciation;
  if(source?.map(t=>t.text).join('')===s.text){
    const a=[],b=[];let position=0;
    for(const token of source){const next=position+token.text.length;if(next<=offset)a.push({...token});else if(position>=offset)b.push({...token});else{a.push({text:token.text.slice(0,offset-position),romanization:null});b.push({text:token.text.slice(offset-position),romanization:null});}position=next;}
    left.pronunciation=a;right.pronunciation=b;
  }
  const result=structuredClone(article);result.sentences.splice(index,1,left,right);return result;
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
}
