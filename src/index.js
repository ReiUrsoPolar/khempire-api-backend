// KH Empire API — backend (ShardCloud).
// SÓ é chamado pelo Worker (portaria), que traz o header X-Internal-Secret.
// Nunca valida chaves nem cobra créditos — isso é o Worker. Aqui só se faz o
// trabalho pesado (downloads, pesquisa, voz) e devolve { ok, resultado } ou
// { ok:false, error_pt }.

import express from 'express'
import ytdl from 'youtube-dl-exec'
import { randomBytes } from 'crypto'
import { readdirSync, statSync, existsSync, unlinkSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, basename } from 'path'
import { tmpdir } from 'os'

const app    = express()
const PORT   = process.env.PORT || 3000
const SECRET = process.env.SHARD_SECRET || ''

// Base pública desta VPS (atrás do Caddy/HTTPS). Descarregamos aqui e servimos
// por um URL NOSSO (/file/<token>) — os URLs diretos do CDN ficam presos ao IP
// da VPS (o bot/outro IP levava 403). Ver memória pv/dl cross-IP.
const PUBLIC_BASE  = (process.env.PUBLIC_BASE || 'https://api-backend.thekhempire.com').replace(/\/+$/, '')
const DL_DIR       = join(tmpdir(), 'khdl')
const FILE_TTL_MS  = 20 * 60_000   // ficheiros apagados 20 min após criados
const MAX_FILESIZE = '64M'         // limite de download (protege o disco + alinha com o WhatsApp)

try { mkdirSync(DL_DIR, { recursive: true }) } catch {}

// Limpeza periódica dos ficheiros antigos.
const _gc = setInterval(() => {
  try {
    const now = Date.now()
    for (const f of readdirSync(DL_DIR)) {
      const p = join(DL_DIR, f)
      try { if (now - statSync(p).mtimeMs > FILE_TTL_MS) unlinkSync(p) } catch {}
    }
  } catch {}
}, 5 * 60_000)
_gc.unref?.()

app.disable('x-powered-by')
app.use(express.json())

// ── Health (PÚBLICO) ──────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ ok: true, service: 'khempire-api-backend' }))
app.get('/health', (_req, res) => res.json({ ok: true, service: 'khempire-api-backend', uptime: Math.round(process.uptime()) }))

// ── Servir ficheiros descarregados (PÚBLICO — o cliente busca sem o segredo) ──
app.get('/file/:name', (req, res) => {
  const name = basename(String(req.params.name || ''))   // anti path-traversal
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ ok: false, error_pt: 'Nome invalido.' })
  const p = join(DL_DIR, name)
  if (!existsSync(p)) return res.status(404).json({ ok: false, error_pt: 'Ficheiro expirou ou nao existe.' })
  return res.sendFile(p)
})

// ── Auth: a partir daqui, só quem traz o SHARD_SECRET (= o Worker) entra.
app.use((req, res, next) => {
  if (!SECRET) return res.status(503).json({ ok: false, error_pt: 'Backend sem SHARD_SECRET configurado.' })
  if ((req.headers['x-internal-secret'] || '') !== SECRET) return res.status(401).json({ ok: false, error_pt: 'Nao autorizado.' })
  next()
})

// ── Núcleo: descarrega `input` (URL OU "ytsearch1:termo") e re-hospeda ──────
async function baixarMedia(input, format) {
  const isSearch = /^(yt|sc)search/i.test(input)
  const token    = randomBytes(12).toString('hex')
  const outTmpl  = join(DL_DIR, `${token}.%(ext)s`)
  const base     = { noWarnings: true, noCheckCertificates: true, retries: 3, maxFilesize: MAX_FILESIZE, output: outTmpl }
  if (!isSearch) base.noPlaylist = true
  // Áudio: extrai mp3 (deixa o yt-dlp escolher o formato, como o CLI que funciona —
  // forçar -f bestaudio/best partia o SoundCloud). Vídeo: melhor mp4.
  const dlOpts = format === 'audio'
    ? { ...base, extractAudio: true, audioFormat: 'mp3' }
    : { ...base, format: 'best[ext=mp4]/best' }

  // 1) Metadados — NÃO-FATAL: se falhar, segue na mesma para o download.
  let info = {}
  try {
    let m = await ytdl(input, { dumpSingleJson: true, noWarnings: true, noCheckCertificates: true })
    if (m && m._type === 'playlist' && Array.isArray(m.entries)) m = m.entries[0] || {}
    info = m || {}
  } catch { /* segue sem metadados */ }
  // 2) Download.
  await ytdl(input, dlOpts)
  // 3) Localiza o ficheiro.
  const file = readdirSync(DL_DIR).find(f => f.startsWith(token + '.'))
  if (!file) return { ok: false }
  return { ok: true, resultado: {
    titulo: info?.title || null,
    autor: info?.uploader || info?.channel || null,
    duracao: info?.duration || null,
    thumbnail: info?.thumbnail || null,
    plataforma: info?.extractor_key || info?.extractor || null,
    formato: format,
    ext: file.split('.').pop(),
    url: `${PUBLIC_BASE}/file/${file}`,
  } }
}

// ── GET /dl?url=...&format=video|audio  (URL OU ytsearch) ─────────────────
app.get('/dl', async (req, res) => {
  const url    = String(req.query.url || '').trim()
  const format = String(req.query.format || 'video').toLowerCase()
  if (!/^https?:\/\//i.test(url) && !/^(yt|sc)search/i.test(url)) return res.status(400).json({ ok: false, error_pt: 'Parametro "url" invalido.' })
  try {
    const r = await baixarMedia(url, format === 'audio' ? 'audio' : 'video')
    if (!r.ok) return res.status(502).json({ ok: false, error_pt: 'Nao consegui descarregar o media (link invalido, privado, grande demais ou nao suportado).' })
    return res.json(r)
  } catch {
    return res.status(502).json({ ok: false, error_pt: 'Nao consegui obter o media (link invalido, privado, grande demais ou nao suportado).' })
  }
})

// ── GET /play?q=nome  (pesquisa SoundCloud + download do MP3) ─────────────
// SoundCloud em vez de YouTube: o YT bloqueia pesquisa/download de servidores
// (datacenter IP → "Sign in to confirm you're not a bot"); o SoundCloud não.
// SoundCloud é só áudio, por isso o play devolve sempre MP3.
app.get('/play', async (req, res) => {
  const q = String(req.query.q || req.query.query || '').trim()
  if (!q) return res.status(400).json({ ok: false, error_pt: 'Falta o parametro "q" (nome da musica).' })
  try {
    const r = await baixarMedia('scsearch1:' + q, 'audio')
    if (!r.ok) return res.status(404).json({ ok: false, error_pt: 'Nenhum resultado encontrado no SoundCloud.' })
    r.resultado.query = q
    r.resultado.fonte = 'SoundCloud'
    return res.json(r)
  } catch {
    return res.status(502).json({ ok: false, error_pt: 'Falha ao pesquisar/baixar.' })
  }
})

// ── GET /tts?texto=...&lang=pt  (texto → voz, mp3 re-hospedado) ───────────
app.get('/tts', async (req, res) => {
  const texto = String(req.query.texto || req.query.text || '').trim()
  const lang  = String(req.query.lang || req.query.voz || 'pt').toLowerCase().slice(0, 5)
  if (!texto) return res.status(400).json({ ok: false, error_pt: 'Falta o parametro "texto".' })
  if (texto.length > 1000) return res.status(400).json({ ok: false, error_pt: 'Texto muito longo (max 1000 caracteres).' })

  const token = randomBytes(12).toString('hex')
  const parts = []
  try {
    const chunks = texto.match(/[\s\S]{1,180}(?:\s|$)/g) || [texto]
    for (let i = 0; i < chunks.length; i++) {
      const t = chunks[i].trim()
      if (!t) continue
      const u  = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(t)}`
      const rr = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) })
      if (!rr.ok) throw new Error('tts http ' + rr.status)
      const p  = join(DL_DIR, `${token}_${i}.mp3`)
      writeFileSync(p, Buffer.from(await rr.arrayBuffer()))
      parts.push(p)
    }
    if (!parts.length) throw new Error('sem audio')

    const out = join(DL_DIR, `${token}.mp3`)
    if (parts.length === 1) {
      renameSync(parts[0], out)
    } else {
      // Concatena os pedaços com o ffmpeg (concat demuxer).
      const listFile = join(DL_DIR, `${token}.txt`)
      writeFileSync(listFile, parts.map(p => `file '${p}'`).join('\n'))
      execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out], { stdio: 'ignore' })
      for (const p of parts) { try { unlinkSync(p) } catch {} }
      try { unlinkSync(listFile) } catch {}
    }
    return res.json({ ok: true, resultado: { texto, lang, url: `${PUBLIC_BASE}/file/${basename(out)}` } })
  } catch {
    for (const p of parts) { try { unlinkSync(p) } catch {} }
    return res.status(502).json({ ok: false, error_pt: 'Falha ao gerar a voz (idioma invalido ou servico indisponivel).' })
  }
})

app.use((_req, res) => res.status(404).json({ ok: false, error_pt: 'Endpoint nao existe no backend.' }))

app.listen(PORT, () => console.log(`khempire-api-backend a ouvir na porta ${PORT}`))
