export function createAnnotations({$,state,tailo,render,toast}){
  const key='slow-reading-markers-v1';let markers={},selectionRange=null;
  try{
    const data=JSON.parse(localStorage.getItem(key)||'{}');
    for(const[id,v]of Object.entries(data))if(v&&typeof v.text==='string'&&Array.isArray(v.ranges))markers[id]={text:v.text,ranges:v.ranges.filter(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=v.text.length&&['yellow','mint','pink'].includes(r.color))};
    $('showTailo').checked=localStorage.getItem('slow-reading-tailo')!=='false';document.body.classList.toggle('hide-tailo',!$('showTailo').checked);
  }catch{toast('部分標記無法還原');}
  function markerFor(s,offset){return markers[s.id]?.text===s.text?markers[s.id].ranges.find(r=>offset>=r.start&&offset<r.end)?.color:null;}
  function characters(parent,text,s,offset){for(const char of text){const span=document.createElement('span');span.className='han';span.dataset.offset=offset;span.textContent=char;const color=markerFor(s,offset);if(color)span.classList.add('ink-'+color);parent.append(span);offset+=char.length;}return offset;}
  function renderText(s,parent){
    if(s.romanization){const line=document.createElement('span');line.className='sentence-romanization';line.textContent=s.romanization;parent.append(line);characters(parent,s.text,s,0);return;}
    let offset=0;const annotation=s.pronunciation?{text:s.text,tokens:s.pronunciation}:tailo[s.id];
    if(annotation?.text!==s.text){characters(parent,s.text,s,0);return;}
    for(const token of annotation.tokens){if(token.romanization){const ruby=document.createElement('ruby');offset=characters(ruby,token.text,s,offset);const rt=document.createElement('rt');rt.textContent=token.romanization;ruby.append(rt);parent.append(ruby);}else offset=characters(parent,token.text,s,offset);}
  }
  function capture(){
    const selection=window.getSelection();selectionRange=null;if(!selection||selection.isCollapsed||!selection.rangeCount)return;
    const range=selection.getRangeAt(0),start=range.cloneRange(),end=range.cloneRange();start.collapse(true);end.collapse(false);const spans=[];
    for(const span of document.querySelectorAll('.sentence-text .han')){
      const a=document.createRange(),b=document.createRange();a.selectNodeContents(span);a.collapse(true);b.selectNodeContents(span);b.collapse(false);
      if(a.compareBoundaryPoints(Range.START_TO_START,end)<0&&b.compareBoundaryPoints(Range.START_TO_START,start)>0)spans.push(span);
    }
    if(!spans.length)return;const id=spans[0].closest('.sentence').dataset.sentenceId;
    if(spans.some(span=>span.closest('.sentence').dataset.sentenceId!==id)){$('selectionHint').textContent='請每次選取同一句內的字詞。';return;}
    const first=spans[0],last=spans.at(-1);selectionRange={id,start:Number(first.dataset.offset),end:Number(last.dataset.offset)+last.textContent.length};
    const s=state.article.sentences.find(s=>s.id===id);$('selectionHint').textContent=`已選取「${s.text.slice(selectionRange.start,selectionRange.end)}」`;
  }
  function storeMark(range,color){
    const s=state.article.sentences.find(s=>s.id===range.id);if(!s)return;const ranges=[];
    for(const r of markers[s.id]?.text===s.text?markers[s.id].ranges:[]){if(r.end<=range.start||r.start>=range.end)ranges.push(r);else{if(r.start<range.start)ranges.push({...r,end:range.start});if(r.end>range.end)ranges.push({...r,start:range.end});}}
    if(color)ranges.push({start:range.start,end:range.end,color});markers[s.id]={text:s.text,ranges};
    try{localStorage.setItem(key,JSON.stringify(markers));}catch{toast('標記無法儲存，請檢查瀏覽器儲存空間');}
    window.getSelection()?.removeAllRanges();selectionRange=null;render();$('selectionHint').textContent=color?'已標記，保存在此裝置。':'已清除選取範圍的標記。';
  }
  for(const id of ['markSelection','eraseSelection'])$(id).onpointerdown=e=>e.preventDefault();
  $('markSelection').onclick=()=>selectionRange?storeMark(selectionRange,$('markerColor').value):toast('請先選取一句內要標記的字詞');
  $('eraseSelection').onclick=()=>selectionRange?storeMark(selectionRange,null):toast('請先選取要清除標記的字詞');
  document.addEventListener('selectionchange',capture);
  $('showTailo').onchange=()=>{document.body.classList.toggle('hide-tailo',!$('showTailo').checked);try{localStorage.setItem('slow-reading-tailo',String($('showTailo').checked));}catch{}};
  $('markerMode').onchange=()=>{document.body.classList.toggle('marker-mode',$('markerMode').checked);$('selectionHint').textContent=$('markerMode').checked?'可點字標記，或選取詞句後按標記。':'選取字詞後標記；開啟螢光筆也能點字。';};
  return{renderText,handleClick(e,s){
    if(selectionRange||!window.getSelection()?.isCollapsed)return true;
    if(!$('markerMode').checked)return false;
    const span=e.target.closest('.han');if(span){const start=Number(span.dataset.offset);storeMark({id:s.id,start,end:start+span.textContent.length},markerFor(s,start)?null:$('markerColor').value);}return true;
  }};
}
