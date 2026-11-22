import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Test footage only. The kill-feed text is intentionally placed in the same
// right-top normalized region used by src/events.js. It exercises real video
// encoding, seek decoding and local OCR; it is not a real VALORANT match.
export async function createHudVideo(page, output, { playerName = 'PlayerOne', duration = 8 } = {}) {
  const encoded = await page.evaluate(async ({ playerName, duration }) => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(20), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_000_000 });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    const feed = frame => {
      ctx.fillStyle = '#151d25'; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#26313a'; ctx.fillRect(0, 54, 1280, 666);
      ctx.fillStyle = '#1d2932'; ctx.fillRect(40, 100, 1200, 500);
      ctx.fillStyle = '#8b959c'; ctx.font = '20px sans-serif';
      ctx.fillText('doctorgame · 合成 HUD 测试（非真实游戏）', 28, 35);
      ctx.fillStyle = '#e9eff2'; ctx.font = '20px sans-serif'; ctx.fillText((frame / 20).toFixed(1) + ' s', 1150, 35);
      const t = frame / 20;
      // Same right-top region as HUD_REGION (x .68, y .07, w .31, h .42).
      const left = 880, icon = 1040, right = 1100, row = 145;
      const drawRow = (a, b, y) => {
        ctx.fillStyle = '#0b0e10'; ctx.fillRect(870, y - 34, 390, 58);
        ctx.fillStyle = '#ffffff'; ctx.font = '28px Arial, sans-serif'; ctx.textBaseline = 'middle';
        ctx.fillText(a, left, y);
        ctx.fillStyle = '#f0b45b'; ctx.fillRect(icon, y - 17, 24, 24);
        ctx.fillStyle = '#ffffff'; ctx.fillText(b, right, y);
        ctx.textBaseline = 'alphabetic';
      };
      if (t >= 1.5 && t < 3.5) drawRow(playerName, 'EnemyOne', row);
      else if (t >= 4.5 && t < 6.2) { ctx.fillStyle = '#0b0e10'; ctx.fillRect(870, row - 34, 390, 58); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('EnemyTwo', left, row); ctx.fillStyle = '#f0b45b'; ctx.fillRect(icon, row - 17, 24, 24); ctx.fillStyle = '#ffffff'; ctx.fillText(playerName, right, row); ctx.textBaseline = 'alphabetic'; }
      else if (t >= 6.7 && t < 7.7) drawRow(playerName, 'EnemyThree', row + 48);
    };
    // initial frame then animate for the requested duration at 20 fps
    const drawFrame = frame => { feed(frame); };
    drawFrame(0); recorder.start();
    for (let frame = 0; frame < 20 * duration; frame++) { drawFrame(frame); await new Promise(resolve => setTimeout(resolve, 50)); }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { playerName, duration });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(encoded, 'base64'));
  return output;
}
