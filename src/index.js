// KH Empire API — backend (ShardCloud).
// SÓ é chamado pelo Worker (portaria), que traz o header X-Internal-Secret.
// Nunca valida chaves nem cobra créditos — isso é o Worker. Aqui só se faz o
// trabalho pesado (downloads, etc.) e devolve { ok, resultado } ou { ok:false, error_pt }.

import express from 'express'
import ytdl from 'youtube-dl-exec'

const app    = express()
const PORT   = process.env.PORT || 3000
const SECRET = process.env.SHARD_SECRET || ''

app.disable('x-powered-by')
app.use(express.json())

// ── Health (PÚBLICO, sem segredo) — para a ShardCloud/o dono saberem que está vivo.
app.get('/', (_req, res) => res.json({ ok: true, service: 'khempire-api-backend' }))
app.get('/health', (_req, res) => res.json({ ok: true, service: 'khempire-api-backend', uptime: Math.round(process.uptime()) }))

// ── Auth: a partir daqui, só quem traz o SHARD_SECRET (= o Worker) entra.
app.use((req, res, next) => {
  if (!SECRET) return res.status(503).json({ ok: false, error_pt: 'Backend sem SHARD_SECRET configurado.' })
  if ((req.headers['x-internal-secret'] || '') !== SECRET) return res.status(401).json({ ok: false, error_pt: 'Nao autorizado.' })
  next()
})

// ── GET /dl?url=...&format=video|audio ─────────────────────────────────
// Extrai a info do media (yt-dlp) e devolve um URL direto. Suporta o que o
// yt-dlp suportar (YouTube, TikTok, Instagram, Facebook, Twitter/X, etc.).
app.get('/dl', async (req, res) => {
  const url    = String(req.query.url || '').trim()
  const format = String(req.query.format || 'video').toLowerCase()
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error_pt: 'Parametro "url" invalido.' })
  try {
    const info = await ytdl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      noPlaylist: true,
    })
    const fmts = Array.isArray(info.formats) ? info.formats : []
    let best
    if (format === 'audio') {
      best = fmts.filter(f => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
                 .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0]
    } else {
      best = fmts.filter(f => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
                 .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
        || fmts.filter(f => f.url && f.vcodec && f.vcodec !== 'none').sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    }
    const direto = (best && best.url) || info.url || (fmts.length ? fmts[fmts.length - 1].url : null)
    if (!direto) return res.status(502).json({ ok: false, error_pt: 'Nao encontrei um formato para descarregar.' })
    return res.json({ ok: true, resultado: {
      titulo: info.title || null,
      autor: info.uploader || info.channel || null,
      duracao: info.duration || null,
      thumbnail: info.thumbnail || null,
      plataforma: info.extractor_key || info.extractor || null,
      formato: format,
      ext: (best && best.ext) || info.ext || null,
      url: direto,
    } })
  } catch {
    return res.status(502).json({ ok: false, error_pt: 'Nao consegui obter o media (link invalido, privado ou nao suportado).' })
  }
})

app.use((_req, res) => res.status(404).json({ ok: false, error_pt: 'Endpoint nao existe no backend.' }))

app.listen(PORT, () => console.log(`khempire-api-backend a ouvir na porta ${PORT}`))
