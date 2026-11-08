"""Offline audio preparation. Requires imageio-ffmpeg and numpy.

Original recordings are never overwritten. Boundaries are pause-based estimates,
not forced alignment or verified Taiwanese speech recognition.
"""
from pathlib import Path
import sys, subprocess, json, re, math

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import numpy as np
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = ROOT / 'public/audio'
OUT.mkdir(parents=True, exist_ok=True)
SECOND = '--second' in sys.argv
blocks = (ROOT / 'manuscript.txt').read_text(encoding='utf-8').strip().split('\n\n')
title, author = blocks[0].splitlines()
paragraphs = blocks[1:]
groups = [[0, 1], [2, 3], [4], [5, 6, 7]]
if SECOND:
    existing = json.loads((ROOT/'public/article-02.json').read_text(encoding='utf-8'))
    title, author, paragraphs = existing['title'], existing['author'], existing['paragraphs']
    groups = [[0,1],[2],[3,4]]
    OUT = OUT/'tang-sng-uan'
    OUT.mkdir(parents=True,exist_ok=True)
tracks, sentences, report = [], [], []

def run(args):
    return subprocess.run([FF, '-hide_banner', '-nostdin', *args], capture_output=True, check=True)

for i, group in enumerate(groups, 1):
    source = ROOT / 'Voice' / (f'{title}-{i}.m4a' if SECOND else f'{title}-{i:02}.m4a')
    pcm = run(['-i', str(source), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-']).stdout
    samples = np.frombuffer(pcm, dtype='<f4')
    duration = len(samples) / 16000
    # 20 ms RMS windows. Include several neighbouring windows in pause detection.
    frame = 320
    rms = np.sqrt(np.mean(samples[:len(samples)//frame*frame].reshape(-1, frame)**2, axis=1))
    peak = float(np.max(np.abs(samples)))
    rms_db = float(20*np.log10(max(float(np.sqrt(np.mean(samples*samples))), 1e-9)))
    threshold = max(0.0015, min(0.014, float(np.percentile(rms, 65)) * .24))
    quiet = rms < threshold
    pauses = []
    start = None
    for j, q in enumerate([*quiet, False]):
        if q and start is None: start = j
        if not q and start is not None:
            if (j-start)*.02 >= .18: pauses.append((start*.02, j*.02))
            start = None
    voiced = np.where(rms >= threshold)[0]
    left = max(0, float(voiced[0])*.02-.14) if len(voiced) else 0
    right = min(duration, float(voiced[-1])*.02+.20) if len(voiced) else duration
    items = []
    for p in group:
        for text in re.findall(r'[^。！？]+[。！？][」』]?|[^。！？]+$', paragraphs[p]):
            if text.strip(): items.append((p+1, text.strip()))
    weights = [max(1, len(re.sub(r'[^\w\u3400-\u9fff\U00020000-\U0002ffff]', '', t))) for _,t in items]
    # Dynamic programming: monotonic pause candidates, duration proportional to text.
    candidates = [(left, 0)] + [((a+b)/2, b-a) for a,b in pauses if a > left+.3 and b < right-.3] + [(right, 0)]
    candidates = sorted(candidates)
    n = len(items)
    total = sum(weights)
    dp = {(0,0): (0, [])}
    for k in range(1,n+1):
        for b in range(1,len(candidates)):
            if k == n and b != len(candidates)-1: continue
            if k < n and b == len(candidates)-1: continue
            target = (right-left)*weights[k-1]/total
            best = None
            for a in range(b):
                prev = dp.get((k-1,a))
                if prev is None: continue
                actual = candidates[b][0]-candidates[a][0]
                if actual < .5: continue
                cost = prev[0] + ((actual-target)/max(target,1))**2 - min(candidates[b][1],1.3)*.09
                if best is None or cost < best[0]: best = (cost, prev[1]+[b])
            if best: dp[(k,b)] = best
    solution = dp.get((n,len(candidates)-1))
    cuts = [left]+[candidates[b][0] for b in solution[1]] if solution else [left]+[left+(right-left)*sum(weights[:k])/total for k in range(1,n+1)]
    # Two-pass EBU R128 normalization keeps all files at a comparable loudness.
    measure = run(['-i', str(source), '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr.decode(errors='replace')
    stats = json.loads(re.search(r'\{[^{}]+"target_offset"[^{}]+\}', measure).group())
    filt = 'loudnorm=I=-18:TP=-1.5:LRA=11:' + ':'.join([
        f'measured_I={stats["input_i"]}', f'measured_TP={stats["input_tp"]}',
        f'measured_LRA={stats["input_lra"]}', f'measured_thresh={stats["input_thresh"]}',
        f'offset={stats["target_offset"]}', 'linear=true'])
    dest = OUT / f'{i:02}.m4a'
    run(['-y', '-i', str(source), '-af', filt, '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(dest)])
    waveform = [round(float(np.max(rms[j:j+5])),4) for j in range(0,len(rms),5)]
    track = {'id':i, 'name':f'錄音 {i:02}', 'paragraphs':[p+1 for p in group], 'src':f'/audio/{"tang-sng-uan/" if SECOND else ""}{i:02}.m4a', 'original':f'/Voice/{source.name}', 'duration':round(duration,3), 'waveform':waveform, 'inputLUFS':float(stats['input_i']), 'targetLUFS':-18}
    tracks.append(track)
    for k, (p,t) in enumerate(items):
        sentences.append({'id':(f'tang-p{p}-s{sum(1 for s in sentences if s["paragraph"]==p)+1}' if SECOND else f's{len(sentences)+1:02}'), 'paragraph':p, 'track':i, 'text':t, 'start':round(cuts[k],3), 'end':round(cuts[k+1],3), 'reviewed':False, 'note':''})
    report.append({'track':i, 'duration':duration, 'rmsDBFS':rms_db, 'peakDBFS':20*math.log10(max(peak,1e-9)), 'loudness':stats, 'pauses':pauses, 'cuts':cuts})

data = {'schemaVersion':1, 'id':'tang-sng-uan' if SECOND else 'ama', 'title':title, 'author':author, 'alignment':'pause-estimate', 'paragraphs':paragraphs, 'tracks':tracks, 'sentences':sentences}
(ROOT/('public/article-02.json' if SECOND else 'public/article.json')).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
(ROOT/('audio-report-02.json' if SECOND else 'audio-report.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps([{'track':t['id'], 'seconds':t['duration'], 'inputLUFS':t['inputLUFS']} for t in tracks],ensure_ascii=False))
print(f'{len(sentences)} sentences prepared; all pending human review.')
