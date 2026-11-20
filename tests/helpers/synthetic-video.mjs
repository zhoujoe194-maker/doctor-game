import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Test footage only: two separated outline tracks in an artificial room.
// Real MediaRecorder encoding exercises import, storage and video seek/decoding.
export async function createSyntheticVideo(page, output) {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(20), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_000_000 });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    const draw = frame => {
      ctx.fillStyle = '#353d45'; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#59646d'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(380, 170); ctx.lineTo(380, 470); ctx.lineTo(0, 720); ctx.fill();
      ctx.fillStyle = '#464f58'; ctx.beginPath(); ctx.moveTo(1280, 0); ctx.lineTo(900, 170); ctx.lineTo(900, 470); ctx.lineTo(1280, 720); ctx.fill();
      ctx.fillStyle = '#67716e'; ctx.beginPath(); ctx.moveTo(0, 720); ctx.lineTo(380, 470); ctx.lineTo(900, 470); ctx.lineTo(1280, 720); ctx.fill();
      ctx.fillStyle = '#222c35'; ctx.fillRect(460, 230, 170, 240);
      ctx.fillStyle = '#72837d'; ctx.fillRect(920, 385, 150, 165);
      ctx.fillStyle = '#80918a'; ctx.fillRect(920, 385, 150, 14);
      const phase = frame % 60;
      if (phase < 48) {
        // Acquisition and settling fit the existing 1.5 s tracking window.
        const x = frame < 60 ? 900 - Math.min(phase, 26) * 12 : 370 + Math.min(phase, 26) * 10;
        ctx.fillStyle = '#4d344d'; ctx.fillRect(x, 330, 50, 150);
        ctx.strokeStyle = '#ffee30'; ctx.lineWidth = 6; ctx.strokeRect(x, 330, 50, 150);
      }
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(625, 360); ctx.lineTo(635, 360); ctx.moveTo(645, 360); ctx.lineTo(655, 360);
      ctx.moveTo(640, 345); ctx.lineTo(640, 355); ctx.moveTo(640, 365); ctx.lineTo(640, 375); ctx.stroke();
      ctx.fillStyle = '#151d25'; ctx.fillRect(0, 0, 1280, 54);
      ctx.fillStyle = '#ffffff'; ctx.font = '20px sans-serif';
      ctx.fillText('doctorgame · 合成测试录像（非真实游戏）', 28, 35);
      ctx.fillText((frame / 20).toFixed(2) + ' s', 1150, 35);
    };
    draw(0); recorder.start();
    for (let frame = 0; frame < 120; frame++) { draw(frame); await new Promise(resolve => setTimeout(resolve, 50)); }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(encoded, 'base64'));
  return output;
}
