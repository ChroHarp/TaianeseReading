import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readdir,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const exec=promisify(execFile);
export async function createRecording(root,dataDirectory,buffer,contentType){
  const type=contentType.split(';')[0].trim();
  const extensions={'audio/webm':'webm','video/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/m4a':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','application/octet-stream':'audio'};
  if(!extensions[type])throw new Error('不支援的音訊格式。請使用 WebM、M4A、WAV、OGG 或 MP3。');
  const binaries=path.join(root,'.tools/python/imageio_ffmpeg/binaries');
  let binary;
  try{binary=process.env.FFMPEG_PATH||path.join(binaries,(await readdir(binaries)).find(file=>/^ffmpeg.*\.exe$/.test(file))||'');}catch{throw new Error('找不到本機 FFmpeg。請依 README 安裝錄音處理工具。');}
  const directory=path.join(dataDirectory,'recordings');await mkdir(directory,{recursive:true});
  const id=randomUUID(),raw=path.join(directory,`${id}.original.${extensions[type]}`),dest=path.join(directory,`${id}.m4a`);
  await writeFile(raw,buffer);
  try{
    const decode=async file=>(await exec(binary,['-v','error','-nostdin','-i',file,'-t','181','-ac','1','-ar','16000','-f','f32le','-'],{encoding:'buffer',maxBuffer:16*1024*1024,timeout:45000})).stdout;
    const pcm=await decode(raw),duration=pcm.length/4/16000;
    if(duration<.1||duration>180)throw new Error('單句錄音須介於 0.1 至 180 秒。');
    const measurement=await exec(binary,['-hide_banner','-nostdin','-i',raw,'-af','loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{timeout:45000,maxBuffer:1024*1024});
    const stats=JSON.parse(measurement.stderr.match(/\{[^{}]+"target_offset"[^{}]+\}/)[0]);
    if(!Number.isFinite(Number(stats.input_i)))throw new Error('單句錄音沒有可用聲音，請重新錄製。');
    const filter='loudnorm=I=-18:TP=-1.5:LRA=11:'+[
      `measured_I=${stats.input_i}`,`measured_TP=${stats.input_tp}`,`measured_LRA=${stats.input_lra}`,
      `measured_thresh=${stats.input_thresh}`,`offset=${stats.target_offset}`,'linear=true'
    ].join(':');
    await exec(binary,['-hide_banner','-v','error','-nostdin','-y','-i',raw,'-af',filter,'-ar','48000','-c:a','aac','-b:a','160k','-movflags','+faststart',dest],{timeout:45000,maxBuffer:1024*1024});
    const normalized=await decode(dest);
    await writeFile(path.join(directory,`${id}.processing.json`),JSON.stringify({pipeline:'two-pass-loudnorm',targetLUFS:-18,truePeakLimitDBTP:-1.5,original:stats,processedAt:new Date().toISOString()},null,2));
    return {src:`/recordings/${id}.m4a`,duration:Math.min(180,Math.round(normalized.length/4/16000*1000)/1000)};
  }catch(error){
    await Promise.allSettled([rm(raw,{force:true}),rm(dest,{force:true})]);
    if(error.message.includes('單句錄音'))throw error;
    throw new Error('無法處理這份音檔，請確認錄音格式與內容有效。');
  }
}
