"""Align supplied word/romanization pairs to the unchanged manuscript.
Missing annotations and source differences stay visible, never guessed.
"""
from pathlib import Path
import json, re, difflib, sys
second = "--second" in sys.argv
third = "--third" in sys.argv
suffix = "-03" if third else "-02" if second else ""
source_file = f"tailo{suffix}-pasted.txt"
article_file = f"article{suffix}.json"
output_file = f"tailo{suffix}.json"
root = Path(__file__).resolve().parents[1]
lines = [re.sub(r'[\u2060\ufeff]', '', s).strip() for s in (root/'sources'/source_file).read_text(encoding='utf-8').splitlines()]
lines = [s for s in lines if s and s != '⇄']
han = lambda s: bool(re.search(r'[\u3400-\u9fff\U00020000-\U0002ffff]', s))
roman = lambda s: not han(s) and bool(re.search(r'[a-zA-ZÀ-ž]', s))
pairs=[]
i=0
while i<len(lines):
    if third and lines[i] == 'iám':
        pairs.append({'text':' iám ', 'romanization':None});i+=1
    elif roman(lines[i]) and i+1<len(lines) and han(lines[i+1]):
        pairs.append({'text':lines[i+1], 'romanization':lines[i]});i+=2
    else:
        pairs.append({'text':lines[i], 'romanization':None});i+=1
article=json.loads((root/'public'/article_file).read_text(encoding='utf-8'))
if second:
    article['sentences'] = [{'id':f'tang-p{i+1}-s{j+1}', 'text':part} for i,text in enumerate(article['paragraphs']) for j,part in enumerate(re.findall(r'[^。！？]+[。！？][」』]?|[^。！？]+$',text))]
if third:
    title_end = next(i + 1 for i in range(len(pairs))
                     if ''.join(p['text'] for p in pairs[:i+1]) == article['title'])
    pairs.insert(title_end, {'text':'\u3000', 'romanization':None})
source=''.join(p['text'] for p in pairs)
target=''.join(s['text'] for s in article['sentences'])
matcher=difflib.SequenceMatcher(None,source,target,autojunk=False)
mapping={a+k:b+k for a,b,n in matcher.get_matching_blocks() for k in range(n)}
annotations={}
offset=0
for p in pairs:
    n=len(p['text'])
    positions=[mapping.get(offset+k) for k in range(n)]
    if p['romanization'] and positions[0] is not None and positions==list(range(positions[0],positions[0]+n)):
        annotations[positions[0]]=(n,p['romanization'])
    offset+=n
result={};offset=0;missing=[]
for s in article['sentences']:
    tokens=[];j=0
    while j<len(s['text']):
        annotation=annotations.get(offset+j)
        if annotation and j+annotation[0]<=len(s['text']):
            n,pronunciation=annotation;tokens.append({'text':s['text'][j:j+n],'romanization':pronunciation});j+=n
        else:
            char=s['text'][j];token={'text':char,'romanization':None}
            if han(char):token['missing']=True;missing.append({'sentence':s['id'],'text':char})
            tokens.append(token);j+=1
    result[s['id']]={'text':s['text'],'tokens':tokens};offset+=len(s['text'])
report={'source':'使用者提供之台羅對照稿','sentences':result,'missing':missing,'differences':[{'source':source[a:b],'manuscript':target[c:d]} for op,a,b,c,d in matcher.get_opcodes() if op!='equal']}
(root/'public'/output_file).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'sentences':len(result),'missing':missing,'differences':report['differences']},ensure_ascii=True))
