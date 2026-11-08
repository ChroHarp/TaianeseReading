"""Re-estimate existing second-article sentence boundaries using clause pauses.

Keeps saved text, sentence IDs, split structure and recording choices. Does not
claim speech recognition or human verification. Default is a preview report;
--apply writes backups and the new article revision.
"""
from pathlib import Path
import sys, json, re, math, bisect
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import numpy as np
import imageio_ffmpeg
import subprocess
base=json.loads((ROOT/'public/article-02.json').read_text(encoding='utf-8'))
saved_path=ROOT/'.local/article-02.json'
article=json.loads(saved_path.read_text(encoding='utf-8')) if saved_path.exists() else json.loads(json.dumps(base))
HAN=re.compile(r'[\u3400-\u9fff\U00020000-\U0002ffff]')
report=[]
for track in article['tracks']:
    items=[s for s in article['sentences'] if s['track']==track['id']]
    # The title added in the saved manuscript is a real part of the recording.
    # A space/newline between title and author is also a possible clause break.
    clauses=[]
    for s in items:
        for text in re.findall(r'[^，；：。！？、\s]+[，；：。！？、」』]*',s['text']):
            weight=len(HAN.findall(text))
            if weight:clauses.append({'sentence':s['id'],'text':text,'weight':weight})
    raw=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-nostdin','-i',str(ROOT/track['original'].lstrip('/')),'-f','f32le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout
    samples=np.frombuffer(raw,dtype='<f4');frame=320
    rms=np.sqrt(np.mean(samples[:len(samples)//frame*frame].reshape(-1,frame)**2,axis=1))
    threshold=max(.0015,min(.014,float(np.percentile(rms,65))*.24))
    voiced=rms>=threshold;indices=np.where(voiced)[0]
    left=max(0,float(indices[0])*.02-.14);right=min(len(samples)/16000,float(indices[-1])*.02+.20)
    pauses=[];start=None
    for j,q in enumerate([*(~voiced),False]):
        if q and start is None:start=j
        if not q and start is not None:
            if (j-start)*.02>=.30 and start*.02>left+.15 and j*.02<right-.15:pauses.append((start*.02,j*.02))
            start=None
    candidates=[(left,0)]+[((a+b)/2,b-a) for a,b in pauses]+[(right,0)]
    # Remove pauses from the duration model; a long rhetorical pause should not
    # be mistaken for several spoken syllables.
    cumulative=np.concatenate(([0.],np.cumsum(voiced)*.02))
    def speech(t):return float(cumulative[min(len(voiced),max(0,round(t/.02)))])
    rate=(speech(right)-speech(left))/sum(c['weight'] for c in clauses)
    n=len(clauses);m=len(candidates)
    dp={(0,0):(0.,[])}
    for k in range(n):
        for a in range(m-1):
            previous=dp.get((k,a))
            if previous is None:continue
            for count in range(1,min(3,n-k)+1):
                selected=clauses[k:k+count]
                if any(c['sentence']!=selected[0]['sentence'] for c in selected):break
                weight=sum(c['weight'] for c in selected);target=weight*rate
                for b in range(a+1,m):
                    if k+count==n and b!=m-1:continue
                    if k+count<n and b==m-1:continue
                    duration=speech(candidates[b][0])-speech(candidates[a][0])
                    if duration<.12:continue
                    ratio=duration/target
                    # Absolute duration error scaled by utterance length plus a
                    # mild penalty for dropping a punctuation boundary.
                    cost=previous[0]+((duration-target)/max(.3,math.sqrt(weight)*rate))**2+.35*(count-1)
                    terminal=bool(re.search(r'[。！？][」』]*$',selected[-1]['text']))
                    if terminal:cost-=min(candidates[b][1],1.1)*.45
                    key=(k+count,b)
                    if key not in dp or cost<dp[key][0]:dp[key]=(cost,previous[1]+[(k,k+count,a,b)])
    solution=dp.get((n,m-1))
    if solution is None:raise RuntimeError(f'Cannot align track {track["id"]}')
    ranges={};segments=[]
    for k,end,a,b in solution[1]:
        sid=clauses[k]['sentence'];begin=candidates[a][0];finish=candidates[b][0]
        if sid not in ranges:ranges[sid]=[begin,finish]
        else:ranges[sid][1]=finish
        segments.append({'text':''.join(c['text'] for c in clauses[k:end]),'start':round(begin,3),'end':round(finish,3)})
    changes=[]
    for s in items:
        start,end=map(lambda t:round(t,3),ranges[s['id']])
        changes.append({'id':s['id'],'text':s['text'],'old':[s['start'],s['end']],'new':[start,end]})
        s.update(start=start,end=end,reviewed=False)
    report.append({'track':track['id'],'method':'clause-pause-estimate','secondsPerVoicedSyllable':rate,'segments':segments,'sentences':changes})
(ROOT/'.local/realignment-02-preview.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
for r in report:
    print('Track',r['track'])
    for s in r['sentences']:print(s['id'],s['old'],'->',s['new'],s['text'].strip())
if '--apply' in sys.argv:
    revision=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    for file in [ROOT/'public/article-02.json',saved_path]:
        if file.exists():file.with_name(file.name+'.before-realignment-'+revision).write_bytes(file.read_bytes())
    # Base root intervals span all saved splits, including the title + body root.
    for s in base['sentences']:
        group=[x for x in article['sentences'] if (x.get('sourceId') or x['id'])==s['id']]
        s.update(start=group[0]['start'],end=group[-1]['end'],reviewed=False)
    for data in [base,article]:data['alignmentRevision']=revision;data['alignment']='clause-pause-estimate'
    (ROOT/'public/article-02.json').write_text(json.dumps(base,ensure_ascii=False,indent=2),encoding='utf-8')
    saved_path.write_text(json.dumps(article,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'audio-realignment-02.json').write_text(json.dumps({'revision':revision,'tracks':report},ensure_ascii=False,indent=2),encoding='utf-8')
