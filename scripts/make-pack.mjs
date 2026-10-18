// Makes the starter voice pack with the Mac's built-in text-to-speech.
// A stand-in for a voice actor: each slot becomes a trimmed, peak-normalized
// 16-bit mono 22.05 kHz WAV (the SD card format) under sim/packs/<pack>/.
//
//   node scripts/make-pack.mjs [voice]      default voice: Samantha
//
// Needs macOS `say` and `afconvert`, and ffmpeg (for trimming silence).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TTS, MURMUR_CLIPS, PACKS } from '../sim/js/packs.js';

const voice = process.argv[2] || 'Samantha';
// Spellings that make the text-to-speech hold a hum longer than the caption suggests.
const HUM_SAY = { m_calm_1: 'Hmmmmm.', m_calm_2: 'Mm hmmm.', m_calm_3: 'Uhhhh...', m_calm_6: 'Hmmm?' };
const root = new URL('../sim/packs/', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'bloop-pack-'));

function render(text, out) {
  const aiff = join(tmp, 'a.aiff'), raw = join(tmp, 'a.wav'), trimmed = join(tmp, 'b.wav');
  execFileSync('say', ['-v', voice, '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', aiff, raw]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-55dB:stop_periods=-1:stop_threshold=-55dB:stop_duration=0.25',
    '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', trimmed]);
  writeFileSync(out, normalize(readFileSync(trimmed)));
}

// Peak-normalize a 16-bit PCM WAV to 90% of full scale, with 10 ms fades.
function normalize(buf) {
  const dataAt = buf.indexOf('data') + 8;
  const n = (buf.length - dataAt) >> 1;
  let peak = 1;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(dataAt + 2 * i)));
  const g = (0.9 * 32767) / peak, fade = 220;
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    buf.writeInt16LE(Math.round(buf.readInt16LE(dataAt + 2 * i) * g * env), dataAt + 2 * i);
  }
  return buf;
}

const manifest = { voice, made: new Date().toISOString().slice(0, 10), packs: { kid: {}, adult: {} }, murmur: {} };
for (const pack of ['kid', 'adult']) {
  const dir = join(root, pack);
  mkdirSync(dir, { recursive: true });
  const jobs = Object.entries(TTS[pack]).map(([id, say]) => ({ id, say, text: PACKS[pack].phrases[id]?.text ?? say }));
  if (pack === 'kid') for (const list of Object.values(MURMUR_CLIPS)) for (const c of list) jobs.push({ id: c.id, say: (HUM_SAY[c.id] ?? c.text).replace(/…/g, '...'), text: c.text });
  for (const j of jobs) {
    render(j.say, join(dir, `${j.id}.wav`));
    manifest.packs[pack][j.id] = { file: `${pack}/${j.id}.wav`, text: j.text };
    process.stdout.write('.');
  }
}
for (const [mood, list] of Object.entries(MURMUR_CLIPS)) manifest.murmur[mood] = list.map(c => c.id);
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log(`\nWrote ${Object.keys(manifest.packs.kid).length} kid + ${Object.keys(manifest.packs.adult).length} adult clips with voice ${voice}.`);
