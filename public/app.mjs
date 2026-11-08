import {validateArticle,formatTime,playbackPlan} from './model.mjs';
import {createAnnotations} from './annotations.mjs';
export const $=id=>document.getElementById(id),audio=$('audio');
export const state={article:null,base:null,selected:0,editing:document.body.dataset.editor==='true',item:null,queue:[],queueIndex:0,kind:'sentence',hooks:{},run:0,loading:false};
let timer,repeatTimer,toastTimer,annotations,learned=new Set(),loadedSource=null;
const audioCache=new Map();
const secondArticle=new URLSearchParams(location.search).get('article')==='02';
const progressKey=secondArticle?'slow-reading-progress-tang-sng-uan-v1':'slow-reading-progress-v1';
async function cachedAudio(src){
  if(!audioCache.has(src))audioCache.set(src,(async()=>{const response=await fetch(src);if(!response.ok)throw new Error('音檔下載失敗');return URL.createObjectURL(await response.blob());})().catch(error=>{audioCache.delete(src);throw error;}));
  return audioCache.get(src);
}
window.addEventListener('pagehide',()=>{for(const value of audioCache.values())value.then(url=>URL.revokeObjectURL(url)).catch(()=>{});audioCache.clear();loadedSource=null;});
export function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4000);}
export function stop(){state.run++;clearTimeout(timer);clearTimeout(repeatTimer);repeatTimer=null;audio.pause();state.loading=false;}
const beforeChange=()=>state.hooks.beforeChange?.()!==false;
export function selectSentence(index,scroll=false){
  state.selected=Math.max(0,Math.min(state.article.sentences.length-1,index));document.querySelector('.sentence.active')?.classList.remove('active');
  const s=state.article.sentences[state.selected],row=$(`row-${s.id}`);row?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((b,i)=>b.classList.toggle('active',i===s.paragraph-1));
  if($('paragraphJump'))$('paragraphJump').value=String(s.paragraph);
  if(scroll&&$('follow').checked&&!state.editing)row?.scrollIntoView({behavior:'smooth',block:'center'});state.hooks.onSelect?.();
}
export function commitArticle(value){state.article=validateArticle(value,state.base);render();}
const activeTrack=()=>state.article.tracks.find(t=>t.id===state.item?.track);
function failed(e){state.loading=false;audio.pause();toast(`無法播放：${e.message||'請檢查音源'}`);}
async function playItem(index){
  const token=state.run,item=state.queue[index];state.queueIndex=index;state.item=item;state.loading=true;
  if(!state.editing)selectSentence(state.article.sentences.findIndex(s=>s.id===item.ids[0]),true);
  try{
    if(loadedSource!==item.src){
      const url=await cachedAudio(item.src);if(token!==state.run)return;audio.src=url;loadedSource=item.src;
      await new Promise((resolve,reject)=>{
        const done=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(new Error('音檔載入失敗'));},timeout=setTimeout(bad,12000);
        function cleanup(){clearTimeout(timeout);audio.removeEventListener('loadedmetadata',done);audio.removeEventListener('error',bad);}
        audio.addEventListener('loadedmetadata',done,{once:true});audio.addEventListener('error',bad,{once:true});audio.load();
      });
    }
    if(token!==state.run)return;
    audio.currentTime=item.start;audio.playbackRate=Number($('speed').value);audio.volume=Number($('volume').value);
    await audio.play();if(token!==state.run)return;state.loading=false;nowPlaying();schedule();
  }catch(e){if(token===state.run)failed(e);}
}
export function playQueue(queue,kind='sentence'){stop();state.queue=queue;state.kind=kind;if(queue.length)playItem(0);}
export function playSelected(kind='sentence',version){if(state.article.textOnly){toast('這篇的錄音尚未加入');return;}if(beforeChange())playQueue(playbackPlan(state.article,kind,state.selected,version||state.hooks.audioVersion?.()||'normalized'),kind);}
function nowPlaying(){const s=state.article.sentences[state.selected];$('nowTitle').textContent=state.kind==='article'?`${state.article.title} · 整篇聆聽`:state.kind==='source'?`${activeTrack().name} · 完整錄音`:s.text;$('nowDetail').textContent=`${state.item.replacement?'單句重錄':activeTrack().name} · 第 ${s.paragraph} 段${state.kind==='paragraph'?' · 整段播放':''}`;}
function advance(){
  if(!state.item||state.loading)return;audio.pause();
  if(state.queueIndex+1<state.queue.length){playItem(state.queueIndex+1);return;}
  if(state.kind==='sentence'&&$('repeat').checked){const token=state.run;repeatTimer=setTimeout(()=>{if(token===state.run)playItem(0);},650);return;}
  stop();$('nowDetail').textContent=state.kind==='article'?'整篇播放完成 · 辛苦矣':'播放完成 · 可以跟著唸一遍';
}
function schedule(){clearTimeout(timer);if(audio.paused||!state.item)return;const token=state.run;timer=setTimeout(()=>{if(token!==state.run||audio.paused)return;if(audio.currentTime>=state.item.end-.025)advance();else schedule();},Math.max(30,(state.item.end-audio.currentTime)/audio.playbackRate*1000));}
function tick(){
  if(state.item){
    $('elapsed').textContent=formatTime(audio.currentTime);$('duration').textContent=formatTime(state.item.duration);$('seek').max=state.item.duration;$('seek').value=audio.currentTime;
    if(!audio.paused&&!state.loading&&audio.currentTime>=state.item.end-.025)advance();
    if(!state.editing&&!audio.paused&&!state.item.replacement){const i=state.article.sentences.findIndex(s=>state.item.ids.includes(s.id)&&audio.currentTime>=s.start&&audio.currentTime<s.end);if(i>=0&&i!==state.selected){selectSentence(i,true);nowPlaying();}}
    state.hooks.onTick?.();
  }requestAnimationFrame(tick);
}
function togglePlay(){if(state.loading||!audio.paused||repeatTimer){stop();return;}if(state.item&&audio.currentTime>=state.item.start&&audio.currentTime<state.item.end-.05)audio.play().catch(failed);else playSelected();}
export function render(){
  state.hooks.beforeRender?.();
  $('paragraphNav').replaceChildren();$('paragraphs').replaceChildren();
  if($('paragraphJump'))$('paragraphJump').replaceChildren();
  for(let p=1;p<=state.article.paragraphs.length;p++){
    const items=state.article.sentences.filter(s=>s.paragraph===p),nav=document.createElement('button');nav.className='nav-item';nav.innerHTML=`<span>${String(p).padStart(2,'0')}</span>`;nav.append(document.createTextNode(items[0].text.slice(0,10)+'…'));
    if($('paragraphJump')){const option=document.createElement('option');option.value=p;option.textContent=`第 ${p} 段 · ${items[0].text.slice(0,9)}…`;$('paragraphJump').append(option);}
    nav.onclick=()=>{if(!beforeChange())return;selectSentence(state.article.sentences.indexOf(items[0]));$(`paragraph-${p}`).scrollIntoView({behavior:'smooth'});};$('paragraphNav').append(nav);
    const section=document.createElement('section');section.className='paragraph';section.id=`paragraph-${p}`;
    const head=document.createElement('div');head.className='paragraph-header';head.innerHTML=`<div class="paragraph-heading"><b>${String(p).padStart(2,'0')}</b> 第 ${p} 段 <span>· ${items.length} 句</span></div>`;
    const play=document.createElement('button');play.className='paragraph-play';play.textContent='▶ 聽這一段';play.onclick=()=>{if(!beforeChange())return;selectSentence(state.article.sentences.indexOf(items[0]));playSelected('paragraph');};play.disabled=!!state.article.textOnly;head.append(play);section.append(head);
    for(const s of items){
      const index=state.article.sentences.indexOf(s),row=document.createElement('div');row.className='sentence';row.id=`row-${s.id}`;row.dataset.sentenceId=s.id;
      const number=document.createElement('span');number.className='sentence-number';number.textContent=String(index+1).padStart(2,'0');
      const text=document.createElement('div');text.className='sentence-text';text.tabIndex=0;text.setAttribute('role','button');text.setAttribute('aria-label',`${state.editing?'校對':'播放'}第 ${index+1} 句：${s.text}`);annotations.renderText(s,text);
      const activate=(panel='text')=>{if(!beforeChange())return;stop();selectSentence(index);if(state.editing)state.hooks.open?.(panel);else playSelected();};
      text.onclick=e=>{if(annotations.handleClick(e,s))return;activate();};text.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};
      const tools=document.createElement('div');tools.className='sentence-tools';
      const listen=document.createElement('button');listen.textContent='▷';listen.setAttribute('aria-label',`試聽第 ${index+1} 句`);listen.onclick=()=>{if(!beforeChange())return;selectSentence(index);playSelected();};
      const done=document.createElement('button');done.textContent=learned.has(s.id)?'✓':'○';done.className=learned.has(s.id)?'learned':'';done.setAttribute('aria-label',`第 ${index+1} 句已練習`);done.setAttribute('aria-pressed',String(learned.has(s.id)));
      done.onclick=()=>{if(learned.has(s.id))learned.delete(s.id);else learned.add(s.id);try{localStorage.setItem(progressKey,JSON.stringify([...learned]));}catch{toast('練習進度暫存失敗');}render();};listen.disabled=!!state.article.textOnly;tools.append(listen);
      if(state.editing){for(const[panel,label]of[['text','編輯'],['split','分割'],['record','重錄']]){const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-label',`${label}第 ${index+1} 句`);button.onclick=()=>activate(panel);tools.append(button);}}else tools.append(done);
      for(const label of [s.replacement?'重錄版':null,state.editing?(s.reviewed?'已確認':'待確認'):null].filter(Boolean)){const badge=document.createElement('span');badge.className='review-marker';badge.textContent=label;tools.append(badge);}
      row.append(number,text,tools);section.append(row);
    }$('paragraphs').append(section);
  }
  const remaining=state.article.sentences.filter(s=>!s.reviewed).length;$('progressLabel').textContent=state.editing?`${state.article.sentences.length-remaining} / ${state.article.sentences.length} 句已確認`:`${learned.size} / ${state.article.sentences.length} 句已練習`;
  $('alignmentNote').textContent=state.article.textOnly?'錄音尚未加入，可先閱讀台羅、標記字詞與記錄練習進度。':remaining?`◌ ${remaining} 句的句界尚待確認。`:'✓ 全部句界已完成校對';
  if($('reviewCount'))$('reviewCount').textContent=`${state.article.sentences.length-remaining} / ${state.article.sentences.length} 句已確認`;
  selectSentence(state.selected);state.hooks.afterRender?.();
}
$('playAll').onclick=()=>{if(!beforeChange())return;selectSentence(0);playSelected('article');};$('togglePlay').onclick=togglePlay;
if($('paragraphJump'))$('paragraphJump').onchange=()=>{if(!beforeChange())return;const paragraph=Number($('paragraphJump').value);selectSentence(state.article.sentences.findIndex(s=>s.paragraph===paragraph));$(`paragraph-${paragraph}`).scrollIntoView({behavior:'smooth',block:'start'});};
for(const[id,delta]of[['previous',-1],['next',1]])$(id).onclick=()=>{if(!beforeChange())return;stop();selectSentence(state.selected+delta,true);playSelected();};
$('speed').onchange=()=>audio.playbackRate=Number($('speed').value);$('volume').oninput=()=>audio.volume=Number($('volume').value);
$('fontSize').onchange=()=>document.documentElement.style.setProperty('--reading-size',`${$('fontSize').value}px`);
$('seek').oninput=()=>{if(!state.item)return;clearTimeout(repeatTimer);repeatTimer=null;audio.currentTime=Number($('seek').value);if(state.kind!=='article'&&(audio.currentTime<state.item.start||audio.currentTime>=state.item.end)){state.queue=[{...state.item,start:0,end:state.item.duration}];state.queueIndex=0;state.item=state.queue[0];state.kind='source';}};
audio.addEventListener('play',()=>{$('togglePlay').textContent='Ⅱ';$('togglePlay').setAttribute('aria-label','暫停');});
audio.addEventListener('pause',()=>{clearTimeout(timer);$('togglePlay').textContent='▶';$('togglePlay').setAttribute('aria-label','播放');});
for(const event of ['playing','seeked','ratechange'])audio.addEventListener(event,schedule);
audio.addEventListener('ended',()=>{if(state.item)advance();});audio.addEventListener('error',()=>{if(!state.loading)failed(new Error('無法讀取音源'));});
document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,button,a,[role=slider],[role=button]')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.code==='ArrowRight')$('next').click();if(e.code==='ArrowLeft')$('previous').click();});
export const ready=(async()=>{
  const responses=await Promise.all([fetch(state.editing?'/api/article'+(secondArticle?'?article=02':''):secondArticle?'/article-02.json':'/article.json'),fetch(state.editing?'/api/base'+(secondArticle?'?article=02':''):secondArticle?'/article-02.json':'/article.json'),fetch(secondArticle?'/tailo-02.json':'/tailo.json')]);if(responses.some(r=>!r.ok))throw new Error('文章資料載入失敗');
  const [value,base,tailo]=await Promise.all(responses.map(r=>r.json()));state.base=base;state.tailo=tailo.sentences;state.article=validateArticle(value,base);
  annotations=createAnnotations({$,state,tailo:tailo.sentences,render,toast});
  try{learned=new Set(JSON.parse(localStorage.getItem(progressKey)||'[]').filter(id=>state.article.sentences.some(s=>s.id===id)));}catch{toast('練習紀錄無法還原');}
  const seconds=Math.round(state.article.tracks.reduce((sum,t)=>sum+t.duration,0));$('totalDuration').textContent=`· ${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
  for(const link of document.querySelectorAll('[data-article]')){
    const current=link.dataset.article===(secondArticle?'02':'01');
    if(current)link.setAttribute('aria-current','page');
    link.href=(state.editing?'/editor':'/')+(link.dataset.article==='02'?'?article=02':'');
    link.onclick=e=>{if(current||!beforeChange())e.preventDefault();};
  }
  if(secondArticle){
    document.title=`${value.title}｜慢慢唸`;
    document.querySelector('h1').textContent=value.title;
    document.querySelector('.byline').firstChild.textContent=value.author+' '; 
    document.querySelector('.collection').innerHTML='<span>篇目 02</span><strong></strong><small></small>';
    document.querySelector('.collection strong').textContent=value.title;
    document.querySelector('.collection small').textContent=`${value.author} · 5 段稿文`;
    document.querySelector('.breadcrumb').textContent='我的書房 / 散文朗讀 / 第二篇';
    for(const link of document.querySelectorAll('a.mode'))link.href=link.getAttribute('href')+'?article=02';
    document.querySelector('.article-heading .eyebrow').textContent='TAIWANESE READING · 02';
    $('introTitle').textContent='阿奇的陪伴，予心肝頭暖暖。';
    if(!state.editing)$('introText').textContent='點一句聽發音，也可以整段播放。讓阿奇的故事，陪你練習台語。';
  }
  if(!state.editing)document.querySelector('.article-footer span:last-child').textContent='兩篇故事 · 慢慢練習';
  render();requestAnimationFrame(tick);
})();
ready.catch(e=>{$('paragraphs').textContent=`載入失敗：${e.message}`;toast('無法載入文章資料');});
