// KH Empire API — backend (ShardCloud).
// SÓ é chamado pelo Worker (portaria), que traz o header X-Internal-Secret.
// Nunca valida chaves nem cobra créditos — isso é o Worker. Aqui só se faz o
// trabalho pesado (downloads, pesquisa, voz) e devolve { ok, resultado } ou
// { ok:false, error_pt }.

import express from 'express'
import { randomBytes } from 'crypto'
import { readdirSync, statSync, existsSync, unlinkSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { join, basename } from 'path'
import { tmpdir } from 'os'

// Chamamos o BINÁRIO yt-dlp diretamente (não o wrapper youtube-dl-exec, que
// pendurava em pesquisas yt/sc — o await nunca resolvia → Caddy 502). O binário
// vem com o pacote youtube-dl-exec.
const pexecFile = promisify(execFile)
const YTDLP = fileURLToPath(new URL('../node_modules/youtube-dl-exec/bin/yt-dlp', import.meta.url))

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

// Efeitos de voz (filtros ffmpeg) — usados pelo /efeito. asetrate muda o pitch
// (voz fina/grossa); atempo muda a velocidade; aecho/areverse/vibrato = efeitos.
const EFEITOS = {
  grave  : 'aresample=44100,asetrate=35280,aresample=44100',  // voz grossa
  menino : 'aresample=44100,asetrate=38000,aresample=44100',  // rapaz
  agudo  : 'aresample=44100,asetrate=57330,aresample=44100',  // voz fina
  menina : 'aresample=44100,asetrate=54000,aresample=44100',  // rapariga
  esquilo: 'aresample=44100,asetrate=64000,aresample=44100',  // chipmunk
  rapido : 'atempo=1.5',
  lento  : 'atempo=0.7',
  eco    : 'aecho=0.8:0.9:1000:0.3',
  reverso: 'areverse',
  robo   : 'vibrato=f=7:d=0.6',
}

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
  // Flags exatamente como o CLI que funciona + --print (metadados na MESMA chamada).
  // --no-simulate é OBRIGATÓRIO: o --print (metadados) implica --simulate (não
  // descarregava) → sem ficheiro. Com --no-simulate, descarrega E imprime.
  const args = ['--no-warnings', '--no-check-certificates', '--no-simulate', '--retries', '3', '--max-filesize', MAX_FILESIZE, '-o', outTmpl]
  if (!isSearch) args.push('--no-playlist')
  // Pesquisa: ignora resultados que falham (DRM/indisponível) e para no 1º que
  // descarregar. + Filtra edições lentas/alteradas (slowed/reverb/nightcore/8d/
  // sped up) — o SoundCloud está cheio delas e davam "música em câmara lenta".
  else args.push(
    '--ignore-errors', '--max-downloads', '1',
    '--match-filter', 'title !~= (?i)(slowed|reverb|nightcore|night core|sped ?up|speed ?up|8 ?d|daycore|chopped)',
  )
  if (format === 'audio') args.push('-x', '--audio-format', 'mp3')
  else                    args.push('-f', 'best[ext=mp4]/best')
  // Imprime 1 linha de metadados DEPOIS de mover o ficheiro (pós-processamento feito).
  args.push('--print', 'after_move:%(title)s|%(uploader)s|%(duration)s|%(thumbnail)s|%(extractor_key)s|%(view_count)s', input)

  let stdout = '', stderr = ''
  try {
    const r = await pexecFile(YTDLP, args, { timeout: 25_000, maxBuffer: 12 * 1024 * 1024 })
    stdout = r.stdout || ''; stderr = r.stderr || ''
  } catch (e) {
    stdout = (e && e.stdout) || ''
    stderr = (e && (e.stderr || e.message)) || ''   // mesmo com erro, o ficheiro pode ter sido criado
  }
  const file = readdirSync(DL_DIR).find(f => f.startsWith(token + '.'))
  if (!file) return { ok: false, detalhe: String(stderr || stdout).replace(/\s+/g, ' ').trim().slice(-400) }
  const linha = (stdout.trim().split('\n').filter(Boolean).pop() || '').split('|')
  const val   = (s) => (s && s !== 'NA' ? s : null)
  let tamanho = 0
  try { tamanho = statSync(join(DL_DIR, file)).size } catch {}
  return { ok: true, resultado: {
    titulo: val(linha[0]),
    autor: val(linha[1]),
    duracao: Number(linha[2]) || null,
    thumbnail: linha[3] && linha[3].startsWith('http') ? linha[3] : null,
    plataforma: val(linha[4]),
    visualizacoes: Number(linha[5]) || null,
    formato: format,
    ext: file.split('.').pop(),
    tamanho,
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
    if (!r.ok) return res.status(502).json({ ok: false, error_pt: 'Nao consegui descarregar o media (link invalido, privado, protegido ou nao suportado).' })
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
    const r = await baixarMedia('scsearch10:' + q, 'audio')
    if (!r.ok) return res.status(404).json({ ok: false, error_pt: 'Nenhum resultado encontrado para essa pesquisa.' })
    r.resultado.query = q
    r.resultado.plataforma = null   // não revelar a fonte
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
    let tamanho = 0
    try { tamanho = statSync(out).size } catch {}
    return res.json({ ok: true, resultado: { texto, lang, tamanho, url: `${PUBLIC_BASE}/file/${basename(out)}` } })
  } catch {
    for (const p of parts) { try { unlinkSync(p) } catch {} }
    return res.status(502).json({ ok: false, error_pt: 'Falha ao gerar a voz (idioma invalido ou servico indisponivel).' })
  }
})

// ── GET /toaudio?url=...  (vídeo → MP3, igual ao /dl com format=audio) ─────
app.get('/toaudio', async (req, res) => {
  const url = String(req.query.url || '').trim()
  if (!/^https?:\/\//i.test(url) && !/^(yt|sc)search/i.test(url)) return res.status(400).json({ ok: false, error_pt: 'Parametro "url" invalido.' })
  try {
    const r = await baixarMedia(url, 'audio')
    if (!r.ok) return res.status(502).json({ ok: false, error_pt: 'Nao consegui extrair o audio (link invalido, privado ou nao suportado).' })
    return res.json(r)
  } catch {
    return res.status(502).json({ ok: false, error_pt: 'Falha ao converter para audio.' })
  }
})

// ── GET /efeito?url=<audio>&tipo=esquilo  (efeito de voz, mp3 re-hospedado) ─
// `url` deve ser um link DIRETO de áudio (ex: o url devolvido por /play ou /toaudio).
app.get('/efeito', async (req, res) => {
  const url  = String(req.query.url || '').trim()
  const tipo = String(req.query.tipo || req.query.efeito || 'esquilo').toLowerCase()
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error_pt: 'Parametro "url" (audio) invalido. Usa um link direto de audio (ex: o url do /play ou /toaudio).' })
  const filtro = EFEITOS[tipo]
  if (!filtro) return res.status(400).json({ ok: false, error_pt: 'Tipo invalido. Usa um de: ' + Object.keys(EFEITOS).join(', ') + '.' })

  const token = randomBytes(12).toString('hex')
  const inp = join(DL_DIR, token + '.src')
  const out = join(DL_DIR, token + '.mp3')
  try {
    const rr = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) })
    if (!rr.ok) throw new Error('fetch ' + rr.status)
    const buf = Buffer.from(await rr.arrayBuffer())
    if (buf.length > 64 * 1024 * 1024) throw new Error('grande')
    writeFileSync(inp, buf)
    execFileSync('ffmpeg', ['-y', '-i', inp, '-af', filtro, '-acodec', 'libmp3lame', out], { stdio: 'ignore', timeout: 25_000 })
    try { unlinkSync(inp) } catch {}
    let tamanho = 0; try { tamanho = statSync(out).size } catch {}
    return res.json({ ok: true, resultado: { tipo, efeito: tipo, tamanho, url: `${PUBLIC_BASE}/file/${basename(out)}` } })
  } catch {
    try { unlinkSync(inp) } catch {}
    try { unlinkSync(out) } catch {}
    return res.status(502).json({ ok: false, error_pt: 'Falha ao aplicar o efeito (audio invalido, muito grande ou indisponivel).' })
  }
})

app.use((_req, res) => res.status(404).json({ ok: false, error_pt: 'Endpoint nao existe no backend.' }))

app.listen(PORT, () => console.log(`khempire-api-backend a ouvir na porta ${PORT}`))
