import {$,audio,state,ready,commitArticle,render,selectSentence,playSelected,playQueue,stop,toast} from '/app.mjs';
import {validateArticle,playbackPlan,splitSentence} from '/model.mjs';
await ready;
const articleQuery=state.article.id==='khoo-kue'?'?article=03':state.article.id==='tang-sng-uan'?'?article=02':'';
const draftKey=`slow-reading-${state.article.id}-v1`;
let formDirty=false,draftDirty=false,loadedId=null,recorder=null,stream=null,recordTimer=null,recordStarted=0,staged=null,previewURL=null,busy=false;
let reviewed=false,panelOpen=false,activePanel='text',splitOffset=0,lastSplit=null,saving=false,loadedRange=null;
const sentence=()=>state.article.sentences[state.selected];
function mount(){if(panelOpen)$(`row-${sentence().id}`)?.append($('editor'));}
function refreshReview(){
  $('sentenceReviewState').textContent=reviewed?'✓ 已確認':formDirty?'待確認 · 尚未儲存':'待確認';
  $('sentenceReviewState').classList.toggle('confirmed',reviewed);$('markPending').hidden=!reviewed;
  const badge=Array.from($(`row-${sentence().id}`)?.querySelectorAll('.sentence-tools .review-marker')||[]).find(x=>/已確認|待校對|待確認/.test(x.textContent));if(badge)badge.textContent=reviewed?'已確認':'待確認';
}
function switchPanel(panel){
  activePanel=panel;for(const name of ['text','split','record']){$(name+'Panel').hidden=name!==panel;$(name+'Tab').setAttribute('aria-selected',String(name===panel));}
  document.querySelector('.editor-actions').hidden=panel==='split';
}
function sourceRange(){return playbackPlan(state.article,'sentence',state.selected,'normalized')[0];}
function updateSplitText(){
  const text=$('splitText').value;splitOffset=$('splitText').selectionStart;
  $('splitLeftText').textContent=text.slice(0,splitOffset)||'（請把游標移到文字之間）';$('splitRightText').textContent=text.slice(splitOffset)||'（後句不可空白）';
}
function prepareSplit(){
  const s=sentence(),range=sourceRange();$('splitText').value=s.text;
  const punctuation=[...s.text.matchAll(/[，；。！？]/g)].map(m=>m.index+1).filter(n=>n<s.text.length);
  splitOffset=punctuation.sort((a,b)=>Math.abs(a-s.text.length/2)-Math.abs(b-s.text.length/2))[0]||Math.floor(s.text.length/2);
  $('splitText').setSelectionRange(splitOffset,splitOffset);updateSplitText();
  $('splitTime').min=(range.start+.1).toFixed(2);$('splitTime').max=(range.end-.1).toFixed(2);$('splitTime').value=(range.start+(range.end-range.start)*splitOffset/s.text.length).toFixed(2);
  $('splitSourceInfo').textContent=`聲音分割使用${s.replacement?'已採用的重錄':'音量調整版原音'}，此句範圍 ${range.start.toFixed(2)}–${range.end.toFixed(2)} 秒。預設切點僅供參考，請試聽調整。`;
  $('splitRomanizationFields').hidden=!s.romanization;$('splitLeftRomanization').value='';$('splitRightRomanization').value='';$('splitMessage').textContent='';
}
function refreshUndo(){$('undoSplit').disabled=!lastSplit||lastSplit.after!==JSON.stringify(state.article);}
function status(text,error=false){$('saveState').textContent=text;$('saveState').classList.toggle('error',error);}
function persist(){draftDirty=true;try{localStorage.setItem(draftKey,JSON.stringify(state.article));status('修改已暫存於此瀏覽器，請儲存專案。');}catch{status('暫存失敗，請儲存或匯出備份。',true);}}
function guard(){if(saving||busy||recorder?.state==='recording'||staged){toast('請先完成儲存，或停止錄音並採用／捨棄，再切換操作。');return false;}return !formDirty||applyForm();}
function fill(){
  const s=sentence();mount();if(formDirty&&loadedId===s.id)return;const rangeSignature=JSON.stringify(sourceRange()),changed=loadedId!==s.id,changedText=$('splitText').value!==s.text,changedRange=rangeSignature!==loadedRange;loadedId=s.id;loadedRange=rangeSignature;formDirty=false;reviewed=s.reviewed;
  $('editSentenceName').textContent=`第 ${state.selected+1} 句 · 第 ${s.paragraph} 段 · 錄音 ${String(s.track).padStart(2,'0')}`;
  $('startTime').value=s.start;$('endTime').value=s.end;$('sentenceText').value=s.text;$('sentenceRomanization').value=s.romanization||'';$('sentenceNote').value=s.note;
  $('restoreRecording').hidden=!s.replacement;if(changed&&!staged&&recorder?.state!=='recording')$('recordState').textContent='按下開始錄音後才會啟用麥克風。';if(changed||changedText||changedRange)prepareSplit();refreshReview();refreshUndo();drawWave();
}
function applyForm(){
  const value=structuredClone(state.article),s=value.sentences[state.selected],old=sentence(),prev=value.sentences[state.selected-1],next=value.sentences[state.selected+1];
  if(!$('startTime').value.trim()||!$('endTime').value.trim()){status('請填寫起點與終點。',true);return false;}
  Object.assign(s,{start:Number($('startTime').value),end:Number($('endTime').value),text:$('sentenceText').value,romanization:$('sentenceRomanization').value.trim(),note:$('sentenceNote').value,reviewed});
  if(s.text!==old.text)delete s.pronunciation;
  if(prev?.track===s.track&&Math.abs(prev.end-old.start)<.001&&s.start!==old.start){prev.end=s.start;prev.reviewed=false;}
  if(next?.track===s.track&&Math.abs(next.start-old.end)<.001&&s.end!==old.end){next.start=s.end;next.reviewed=false;}
  try{validateArticle(value,state.base);formDirty=false;commitArticle(value);persist();return true;}catch(e){status(e.message,true);toast(e.message);return false;}
}
async function saveProject(){
  stop();if(formDirty&&!applyForm())return false;saving=true;$('saveProject').disabled=true;$('confirmSentence').disabled=true;const snapshot=JSON.stringify(state.article);
  try{
    const response=await fetch('/api/article'+articleQuery,{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});if(!response.ok)throw new Error(await response.text());
    if(formDirty||JSON.stringify(state.article)!==snapshot){status('先前版本已儲存；還有新修改，請再儲存。');return false;}
    draftDirty=false;try{localStorage.removeItem(draftKey);}catch{}status('已儲存本機專案。更新線上練習頁前，需重新建立部署版本。');toast('校對專案已儲存');return true;
  }catch(e){status(`儲存失敗：${e.message}。可先匯出 JSON 備份。`,true);return false;}finally{saving=false;$('saveProject').disabled=false;$('confirmSentence').disabled=false;}
}
function drawWave(){
  if(!panelOpen||!document.querySelector('.timing-details').open)return;
  const s=sentence(),t=state.article.tracks.find(t=>t.id===s.track),canvas=$('waveform'),width=canvas.clientWidth||600,dpr=devicePixelRatio||1,height=100;
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==height*dpr){canvas.width=Math.round(width*dpr);canvas.height=height*dpr;}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const start=Number($('startTime').value),end=Number($('endTime').value);ctx.fillStyle='#c9d8bd';ctx.fillRect(start/t.duration*width,0,(end-start)/t.duration*width,height);
  const max=Math.max(...t.waveform,.001);ctx.strokeStyle='#739267';ctx.lineWidth=1;ctx.beginPath();t.waveform.forEach((v,i)=>{const x=i/t.waveform.length*width,amp=Math.max(1,v/max*37);ctx.moveTo(x,50-amp);ctx.lineTo(x,50+amp);});ctx.stroke();
  for(const [time,color]of[[start,'#48734f'],[end,'#bb8855']]){ctx.fillStyle=color;ctx.fillRect(time/t.duration*width-1,0,2,height);}
  const time=state.item?.track===t.id&&!state.item.replacement?audio.currentTime:0;ctx.fillStyle='#263d34';ctx.fillRect(time/t.duration*width,0,1,height);
  $('waveTime').textContent=`${time.toFixed(2)} / ${t.duration.toFixed(2)} 秒`;
  canvas.setAttribute('aria-valuemax',t.duration);canvas.setAttribute('aria-valuenow',time.toFixed(2));
}
function seekWave(seconds){if(!guard())return;const plan=playbackPlan(state.article,'source',state.selected,$('audioVersion').value);plan[0].start=Math.max(0,Math.min(plan[0].end-.02,seconds));playQueue(plan,'source');}
state.hooks={beforeChange:guard,beforeRender:()=>$('editorParking').append($('editor')),onSelect:fill,onTick:drawWave,audioVersion:()=>$('audioVersion').value,open:(panel='text')=>{panelOpen=true;mount();switchPanel(panel);$('editor').scrollIntoView({behavior:'smooth',block:'nearest'});}};
for(const field of ['startTime','endTime','sentenceText','sentenceRomanization','sentenceNote'])$(field).addEventListener('input',()=>{formDirty=true;reviewed=false;status('本句已修改，儲存後請重新試聽確認。');refreshReview();drawWave();});
document.querySelector('.timing-details').addEventListener('toggle',drawWave);
for(const panel of ['text','split','record'])$(panel+'Tab').onclick=()=>{if(guard())switchPanel(panel);};
$('closeEditor').onclick=()=>{if(!guard())return;panelOpen=false;$('editorParking').append($('editor'));};
$('saveProject').onclick=async()=>{if(!guard())return;await saveProject();};
$('confirmSentence').onclick=async()=>{if(!guard())return;reviewed=true;formDirty=true;if(applyForm())await saveProject();};
$('markPending').onclick=async()=>{if(!guard())return;reviewed=false;formDirty=true;if(applyForm())await saveProject();};
$('nextPending').onclick=()=>{if(!guard())return;const count=state.article.sentences.length;for(let step=1;step<=count;step++){const i=(state.selected+step)%count;if(!state.article.sentences[i].reviewed){stop();selectSentence(i);state.hooks.open('text');return;}}toast('全部句子都已確認。');};
for(const event of ['click','keyup','select'])$('splitText').addEventListener(event,updateSplitText);
$('playForSplit').onclick=()=>playSelected('sentence','normalized');
$('useSplitPosition').onclick=()=>{const range=sourceRange();if(state.item?.src!==range.src||audio.currentTime<=range.start||audio.currentTime>=range.end){toast('請先按「播放此句找切點」，在句中暫停再設定。');return;}$('splitTime').value=audio.currentTime.toFixed(2);};
for(const[id,side]of[['previewSplitLeft','left'],['previewSplitRight','right']])$(id).onclick=()=>{if(!guard())return;const range=sourceRange(),time=Number($('splitTime').value);if(!Number.isFinite(time)||time<=range.start||time>=range.end){toast('分割點必須在這句聲音範圍內。');return;}playQueue([{...range,start:side==='left'?range.start:time,end:side==='left'?time:range.end}],'boundary');};
$('commitSplit').onclick=async()=>{
  if(!guard())return;stop();let controls=[];try{
    const s=sentence(),before=structuredClone(state.article),index=state.selected;
    const value=splitSentence(state.article,index,{offset:splitOffset,time:Number($('splitTime').value),id:`${s.sourceId||s.id}-${crypto.randomUUID().slice(0,8)}`,tokens:s.pronunciation||state.tailo[s.id]?.tokens,leftRomanization:$('splitLeftRomanization').value,rightRomanization:$('splitRightRomanization').value});
    value.sentences[index].reviewed=true;value.sentences[index+1].reviewed=true;
    const validated=validateArticle(value,state.base);
    saving=true;controls=Array.from($('splitPanel').querySelectorAll('button,input,textarea')).map(el=>({el,disabled:el.disabled}));for(const{el}of controls)el.disabled=true;
    $('commitSplit').textContent='正在儲存…';$('splitMessage').textContent='正在儲存兩個分句…';
    const response=await fetch('/api/article'+articleQuery,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(validated)});
    if(!response.ok)throw new Error(await response.text());
    formDirty=false;commitArticle(validated);lastSplit={before,index,after:JSON.stringify(state.article)};draftDirty=false;try{localStorage.removeItem(draftKey);}catch{}
    panelOpen=false;$('editorParking').append($('editor'));switchPanel('text');refreshUndo();
    $(`row-${sentence().id}`)?.scrollIntoView({behavior:'smooth',block:'nearest'});toast('已分割，兩句皆已確認並儲存');
  }catch(e){$('splitMessage').textContent=`未儲存分割：${e.message}`;toast(`分割未完成：${e.message}`);}
  finally{saving=false;for(const{el,disabled}of controls)el.disabled=disabled;$('commitSplit').textContent='確認分割並儲存';refreshUndo();}
};
$('undoSplit').onclick=async()=>{if(!guard()||!lastSplit||lastSplit.after!==JSON.stringify(state.article))return;stop();const previous=lastSplit;lastSplit=null;state.selected=previous.index;commitArticle(previous.before);persist();await saveProject();switchPanel('split');$('splitMessage').textContent='已復原最近一次分割。';};
$('previewSentence').onclick=()=>playSelected();$('playSource').onclick=()=>playSelected('source');
$('previewBoundary').onclick=()=>{if(!guard())return;const s=sentence(),plan=playbackPlan(state.article,'source',state.selected,$('audioVersion').value);plan[0].start=Math.max(0,s.end-1.5);plan[0].end=Math.min(plan[0].end,s.end+1.5);playQueue(plan,'boundary');};
for(const[id,field]of[['setStart','startTime'],['setEnd','endTime']])$(id).onclick=()=>{if(state.item?.track!==sentence().track||state.item.replacement){toast('請先播放原始或音量調整版錄音，再設定句界。');return;}$(field).value=audio.currentTime.toFixed(2);reviewed=false;formDirty=true;refreshReview();drawWave();};
$('waveform').onclick=e=>seekWave((e.clientX-e.currentTarget.getBoundingClientRect().left)/e.currentTarget.clientWidth*state.article.tracks.find(t=>t.id===sentence().track).duration);
$('waveform').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const duration=state.article.tracks.find(t=>t.id===sentence().track).duration;seekWave(e.key==='Home'?0:e.key==='End'?duration-.1:(state.item?.track===sentence().track&&!state.item.replacement?audio.currentTime:0)+(e.key==='ArrowLeft'?-1:1));}};
$('audioVersion').onchange=()=>{stop();state.item=null;toast('下次試聽會使用所選音源。');};
$('exportData').onclick=()=>{if(formDirty&&!applyForm())return;const url=URL.createObjectURL(new Blob([JSON.stringify(state.article,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=state.article.title+'-校對.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('importData').onchange=async e=>{const file=e.target.files[0];if(!file||!guard())return;stop();try{if(file.size>200000)throw new Error('檔案過大');const value=validateArticle(JSON.parse(await file.text()),state.base);formDirty=false;commitArticle(value);persist();toast('已匯入，請儲存專案');}catch(error){toast(`匯入失敗：${error.message}`);}finally{e.target.value='';}};
function releaseStream(){clearInterval(recordTimer);recordTimer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;}
function clearStage(){if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;staged=null;$('recordPreview').pause();$('recordPreview').removeAttribute('src');$('recordPreview').hidden=true;$('adoptRecording').disabled=true;$('discardRecording').disabled=true;$('startRecord').disabled=false;$('importRecording').disabled=false;}
function stage(blob){if(!blob.size){$('recordState').textContent='錄音沒有內容，請重試。';return;}staged={blob,id:sentence().id};previewURL=URL.createObjectURL(blob);$('recordPreview').src=previewURL;$('recordPreview').hidden=false;$('adoptRecording').disabled=false;$('discardRecording').disabled=false;$('startRecord').disabled=true;$('importRecording').disabled=true;$('recordState').textContent='錄音已準備好。先試聽，再採用或捨棄。';}
$('startRecord').onclick=async()=>{
  if(!guard())return;stop();
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('recordState').textContent='此瀏覽器不支援直接錄音，可改用「匯入音檔」。';return;}
  busy=true;$('startRecord').disabled=true;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
    recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{$('recordState').textContent='錄音發生錯誤，請重試。';releaseStream();$('startRecord').disabled=false;$('stopRecord').disabled=true;};
    recorder.onstop=()=>{releaseStream();$('stopRecord').disabled=true;stage(new Blob(chunks,{type:recorder.mimeType||'audio/webm'}));};
    recorder.start(250);recordStarted=Date.now();$('stopRecord').disabled=false;$('importRecording').disabled=true;
    recordTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-recordStarted)/1000);$('recordState').textContent=`● 錄音中 ${seconds} 秒 · 上限 180 秒`;if(seconds>=180&&recorder.state==='recording')recorder.stop();},250);
  }catch(e){releaseStream();$('startRecord').disabled=false;$('recordState').textContent=e.name==='NotAllowedError'?'麥克風未獲允許。可開啟權限後重試，或匯入音檔。':`無法錄音：${e.message}`;}finally{busy=false;}
};
$('stopRecord').onclick=()=>{if(recorder?.state==='recording')recorder.stop();};
$('importRecording').onchange=e=>{const file=e.target.files[0];if(!file)return;if(!guard()){e.target.value='';return;}if(file.size>20*1024*1024){toast('音檔不可超過 20 MB');e.target.value='';return;}stop();stage(file);e.target.value='';};
$('discardRecording').onclick=()=>{clearStage();$('recordState').textContent='已捨棄這次錄音，採用版本未變更。';};
$('adoptRecording').onclick=async()=>{
  if(!staged||busy)return;busy=true;$('adoptRecording').disabled=true;$('discardRecording').disabled=true;$('recordState').textContent='正在轉檔、平衡音量並儲存到本機…';
  try{
    if(draftDirty&&!await saveProject())throw new Error('請先儲存本句，再採用重錄。');
    const response=await fetch(`/api/recordings/${staged.id}${articleQuery}`,{method:'POST',headers:{'Content-Type':staged.blob.type||'application/octet-stream'},body:staged.blob});if(!response.ok)throw new Error(await response.text());
    const replacement=await response.json(),value=structuredClone(state.article),s=value.sentences.find(s=>s.id===staged.id);s.replacement=replacement;s.reviewed=false;
    formDirty=false;commitArticle(value);persist();clearStage();const saved=await saveProject();$('recordState').textContent=saved?'已採用這次重錄，練習播放將使用新版本。原音仍保留。':'重錄已加入草稿，尚未儲存至專案。請查看儲存訊息後重試。';
  }catch(e){$('recordState').textContent=`採用失敗：${e.message}`;$('adoptRecording').disabled=false;$('discardRecording').disabled=false;}finally{busy=false;}
};
$('restoreRecording').onclick=async()=>{if(!guard())return;stop();const value=structuredClone(state.article);delete value.sentences[state.selected].replacement;value.sentences[state.selected].reviewed=false;commitArticle(value);persist();await saveProject();$('recordState').textContent='已恢復原音；重錄檔仍保存在本機。';};
$('compareOriginal').onclick=()=>{if(formDirty&&!applyForm())return;playQueue(playbackPlan(state.article,'sentence',state.selected,'original'),'sentence');};
window.addEventListener('resize',drawWave);window.addEventListener('beforeunload',e=>{if(formDirty||draftDirty||staged||recorder?.state==='recording'){e.preventDefault();e.returnValue='';}releaseStream();});
try{const draft=localStorage.getItem(draftKey);if(draft){const value=JSON.parse(draft);if(value.alignmentRevision!==state.base.alignmentRevision){localStorage.setItem(draftKey+'-before-alignment-update',draft);localStorage.removeItem(draftKey);toast('句界已更新，已載入專案新版；舊草稿另存備份。');}else{for(const s of value.sentences)s.text=s.text.replace('擲挕捒抨去','擲挕捒');commitArticle(value);draftDirty=true;status('已還原尚未儲存的本機草稿。');}}}catch{toast('草稿無法還原，已使用專案版本。');}
fill();
