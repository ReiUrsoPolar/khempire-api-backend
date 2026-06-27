// KH Empire API — backend (ShardCloud).
// SÓ é chamado pelo Worker (portaria), que traz o header X-Internal-Secret.
// Nunca valida chaves nem cobra créditos — isso é o Worker. Aqui só se faz o
// trabalho pesado (downloads, etc.) e devolve { ok, resultado } ou { ok:false, error_pt }.

import express from 'express'
import ytdl from 'youtube-dl-exec'
import { randomBytes } from 'crypto'
import { readdirSync, statSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'

const app    = express()
const PORT   = process.env.PORT || 3000
const SECRET = process.env.SHARD_SECRET || ''

// Base pública desta VPS (atrás do Caddy/HTTPS) — usada para servir os ficheiros
// descarregados. Os URLs diretos do CDN (YouTube/TikTok) ficam presos ao IP da
// VPS (ip=...), por isso o BOT (outro IP) leva 403 ao buscá-los. Solução:
// descarregamos aqui e servimos por um URL NOSSO (/file/<token>), que qualquer
// IP pode buscar. Ver memória pv/dl cross-IP.
const PUBLIC_BASE  = (process.env.PUBLIC_BASE || 'https://api-backend.thekhempire.com').replace(/\/+$/, '')
const DL_DIR       = join(tmpdir(), 'khdl')
const FILE_TTL_MS  = 20 * 60_000   // ficheiros apagados 20 min após criados
const MAX_FILESIZE = '64M'         // limite de download (protege o disco + alinha com o WhatsApp)

try { mkdirSync(DL_DIR, { recursive: true }) } catch {}

// Limpeza periódica dos ficheiros antigos (não bloqueia o arranque/encerramento).
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

// ── Health (PÚBLICO, sem segredo) — para a ShardCloud/o dono saberem que está vivo.
app.get('/', (_req, res) => res.json({ ok: true, service: 'khempire-api-backend' }))
app.get('/health', (_req, res) => res.json({ ok: true, service: 'khempire-api-backend', uptime: Math.round(process.uptime()) }))

// ── Servir ficheiros descarregados (PÚBLICO — o bot busca sem o segredo) ──────
// Token aleatório e curto (efémero, apagado por TTL) → funciona como signed URL.
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

// ── GET /dl?url=...&format=video|audio ─────────────────────────────────
// Descarrega o media NA VPS (yt-dlp, da VPS o CDN não dá 403) e devolve um URL
// NOSSO (/file/<token>) que o bot consegue buscar de qualquer IP. Suporta o que
// o yt-dlp suportar (YouTube, TikTok, Instagram, Facebook, Twitter/X, etc.).
app.get('/dl', async (req, res) => {
  const url    = String(req.query.url || '').trim()
  const format = String(req.query.format || 'video').toLowerCase()
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error_pt: 'Parametro "url" invalido.' })

  const token   = randomBytes(12).toString('hex')
  const outTmpl = join(DL_DIR, `${token}.%(ext)s`)
  const base    = {
    noWarnings: true, noCheckCertificates: true, noPlaylist: true,
    retries: 3, maxFilesize: MAX_FILESIZE, output: outTmpl,
  }
  const dlOpts = format === 'audio'
    ? { ...base, extractAudio: true, audioFormat: 'mp3', format: 'bestaudio/best' }
    : { ...base, format: 'best[ext=mp4]/best' }

  try {
    // 1) Metadados (rápido, não descarrega).
    const info = await ytdl(url, { dumpSingleJson: true, noWarnings: true, noCheckCertificates: true, noPlaylist: true })
    // 2) Descarrega o ficheiro para a VPS.
    await ytdl(url, dlOpts)
    // 3) Localiza o ficheiro descarregado (token.<ext>).
    const file = readdirSync(DL_DIR).find(f => f.startsWith(token + '.'))
    if (!file) return res.status(502).json({ ok: false, error_pt: 'Nao consegui descarregar o media (link invalido, privado, grande demais ou nao suportado).' })
    return res.json({ ok: true, resultado: {
      titulo: info.title || null,
      autor: info.uploader || info.channel || null,
      duracao: info.duration || null,
      thumbnail: info.thumbnail || null,
      plataforma: info.extractor_key || info.extractor || null,
      formato: format,
      ext: file.split('.').pop(),
      url: `${PUBLIC_BASE}/file/${file}`,
    } })
  } catch {
    return res.status(502).json({ ok: false, error_pt: 'Nao consegui obter o media (link invalido, privado, grande demais ou nao suportado).' })
  }
})

app.use((_req, res) => res.status(404).json({ ok: false, error_pt: 'Endpoint nao existe no backend.' }))

app.listen(PORT, () => console.log(`khempire-api-backend a ouvir na porta ${PORT}`))
