// montagens.js — brincadeiras de imagem com ImageMagick (auto-hospedado).
// ship/casal, wanted, rip, jail, welcome, quote. Recebem ficheiros JÁ
// descarregados (paths locais) + binários/fonte por parâmetro, para correr na
// VPS e poder ser testado fora dela (mesmo padrão do logo.js).
import { execFileSync } from 'child_process'
import { unlinkSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

function _ctx(imBin, dir) {
  const tmp = []
  const nt = (ext = 'png') => { const p = join(dir, randomBytes(8).toString('hex') + '.' + ext); tmp.push(p); return p }
  const im = (args, timeout = 20_000) => execFileSync(imBin, args, { stdio: 'ignore', timeout })
  const limpar = () => { for (const f of tmp) { try { unlinkSync(f) } catch {} } }
  return { tmp, nt, im, limpar }
}
function _txt(s, max) {
  // Tira quebras de linha e caracteres com significado para o ImageMagick
  // (-draw/-annotate/caption:): \, %, aspas, crase e @ (evita @ficheiro).
  return String(s || '').replace(/[\r\n\f\\%"'`@]+/g, ' ').replace(/^[-]+/, '').slice(0, max).trim()
}
// % determinística a partir dos inputs (mesmo par → mesma %), nunca 0.
function _pct(...partes) {
  let h = 7
  for (const c of partes.join('|')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return 1 + (h % 100)
}
// resize "cover" (preenche o quadrado/retângulo, corta o excesso)
function _cover(w, h) { return ['-resize', `${w}x${h}^`, '-gravity', 'center', '-extent', `${w}x${h}`] }

// ── /ship?img1=&img2= → casal + % de compatibilidade ──────────────────────
export function gerarShip({ img1, img2, nome1, nome2, seed1, seed2, imBin, font, dir, out }) {
  const { nt, im, limpar } = _ctx(imBin, dir)
  const W = 820, H = 430, S = 330
  // % a partir das URLs originais (estáveis) — não dos paths temporários.
  const pct = _pct(seed1 || img1, seed2 || img2, nome1 || '', nome2 || '')
  try {
    const a = nt(), b = nt(), bg = nt()
    im(['(', img1, ...(_cover(S, S)), ')', '-bordercolor', 'white', '-border', '4', a])
    im(['(', img2, ...(_cover(S, S)), ')', '-bordercolor', 'white', '-border', '4', b])
    im(['-size', `${W}x${H}`, 'radial-gradient:#3a0d24-#150109', bg])
    const badgeY = Math.round(H / 2)
    im([bg,
      a, '-gravity', 'west', '-geometry', '+30+-20', '-composite',
      b, '-gravity', 'east', '-geometry', '+30+-20', '-composite',
      // coração no centro
      '-fill', '#ff2d6b', '-stroke', 'white', '-strokewidth', '3',
      '-draw', `path 'M ${W / 2},${badgeY - 36} C ${W / 2 - 46},${badgeY - 86} ${W / 2 - 86},${badgeY - 20} ${W / 2},${badgeY + 40} C ${W / 2 + 86},${badgeY - 20} ${W / 2 + 46},${badgeY - 86} ${W / 2},${badgeY - 36} Z'`,
      // % por baixo do coração
      '-stroke', 'none', '-font', font, '-pointsize', '60', '-fill', 'white', '-gravity', 'south',
      '-annotate', '+0+18', `${pct}%`,
      out])
    return { out, pct }
  } finally { limpar() }
}

// ── /wanted?img= → cartaz "PROCURADO" ─────────────────────────────────────
export function gerarWanted({ img, nome, recompensa, seed, imBin, font, dir, out }) {
  const { nt, im, limpar } = _ctx(imBin, dir)
  const W = 640, H = 860, S = 380
  const quem = _txt(nome, 22) || 'PROCURADO'
  // recompensa por omissão estável (da URL original, não do path temporário).
  const reward = (_txt(recompensa, 14) || ('$' + (10 + _pct(seed || img) * 9) + ',000')).replace(/[^0-9$.,A-Za-z ]/g, '')
  try {
    const foto = nt(), bg = nt()
    im(['(', img, ...(_cover(S, S)), '-modulate', '105,55', '-sepia-tone', '70%', ')', '-bordercolor', '#3a2a12', '-border', '6', foto])
    // pergaminho com moldura dupla
    im(['-size', `${W}x${H}`, 'xc:#d8c49a',
      '-fill', 'none', '-stroke', '#3a2a12', '-strokewidth', '8', '-draw', `rectangle 18,18 ${W - 18},${H - 18}`,
      '-strokewidth', '3', '-draw', `rectangle 34,34 ${W - 34},${H - 34}`, bg])
    im([bg, '-gravity', 'north',
      '-font', font, '-fill', '#2a1d0c', '-pointsize', '116', '-annotate', '+0+60', 'WANTED',
      foto, '-gravity', 'center', '-geometry', '+0+-10', '-composite',
      '-gravity', 'south', '-font', font, '-fill', '#2a1d0c',
      '-pointsize', '44', '-annotate', '+0+170', 'DEAD OR ALIVE',
      '-pointsize', '34', '-annotate', '+0+112', quem,
      '-pointsize', '52', '-annotate', '+0+30', `REWARD ${reward}`,
      out])
    return { out }
  } finally { limpar() }
}

// ── /rip?img= → lápide "R.I.P." ────────────────────────────────────────────
export function gerarRip({ img, nome, imBin, font, dir, out }) {
  const { nt, im, limpar } = _ctx(imBin, dir)
  const W = 720, H = 780
  const quem = _txt(nome, 20)
  const ano = new Date().getFullYear()
  try {
    const foto = nt(), bg = nt()
    im(['(', img, ...(_cover(240, 240)), '-colorspace', 'Gray', ')', '-bordercolor', '#cfd6dc', '-border', '5', foto])
    // céu + relva + lápide arredondada
    im(['-size', `${W}x${H}`, 'gradient:#8aa6c2-#42536b',
      '-fill', '#3d5a36', '-draw', `rectangle 0,${H - 120} ${W},${H}`,
      '-fill', '#9aa3ab', '-stroke', '#5c656d', '-strokewidth', '4',
      '-draw', `roundrectangle 150,150 ${W - 150},${H - 120} 120,120`, bg])
    im([bg, '-gravity', 'north',
      '-font', font, '-fill', '#2b3138', '-pointsize', '88', '-annotate', '+0+150', 'R.I.P.',
      foto, '-gravity', 'center', '-geometry', '+0+55', '-composite',
      '-gravity', 'center', '-font', font, '-fill', '#2b3138', '-pointsize', '46', '-annotate', `+0+210`, quem || 'Descansa em paz',
      '-pointsize', '30', '-annotate', '+0+260', `† ${ano}`,
      out])
    return { out }
  } finally { limpar() }
}

// ── /jail?img= → "atrás das grades" ────────────────────────────────────────
export function gerarJail({ img, imBin, dir, out }) {
  const { nt, im, limpar } = _ctx(imBin, dir)
  const S = 640
  try {
    const base = nt()
    im(['(', img, ...(_cover(S, S)), '-modulate', '80', ')', base])
    const a = [base, '-fill', '#0c0c0c', '-stroke', '#2a2a2a', '-strokewidth', '2']
    // 5 barras verticais + 2 horizontais
    const nbar = 5, bw = 30
    for (let i = 1; i <= nbar; i++) {
      const x = Math.round((S / (nbar + 1)) * i - bw / 2)
      a.push('-draw', `rectangle ${x},0 ${x + bw},${S}`)
    }
    a.push('-draw', `rectangle 0,40 ${S},${40 + bw}`, '-draw', `rectangle 0,${S - 70} ${S},${S - 70 + bw}`, out)
    im(a)
    return { out }
  } finally { limpar() }
}

// ── /welcome?img=&nome=&sub= → cartão de boas-vindas (donos de grupo) ───────
const WELCOME_TEMAS = {
  polar: ['#0a2540', '#00e0ff'], neon: ['#2b0a4d', '#ff2d95'], fogo: ['#2a0d04', '#ff7b00'],
  matrix: ['#05140a', '#00ff66'], roxo: ['#1b0833', '#c44eff'], azul: ['#06122a', '#3b82f6'],
}
export function gerarWelcome({ img, nome, sub, titulo, estilo, imBin, font, dir, out }) {
  const { nt, im, limpar } = _ctx(imBin, dir)
  const W = 1280, H = 720, AV = 300
  const [c0, c1] = WELCOME_TEMAS[String(estilo || 'polar').toLowerCase()] || WELCOME_TEMAS.polar
  const titulo_ = (_txt(titulo, 18) || 'BEM-VINDO(A)').toUpperCase()
  const quem = _txt(nome, 22) || 'Membro'
  const subt = _txt(sub, 46)
  try {
    const bg = nt(), mask = nt(), av = nt()
    // fundo: cor escura + spotlight na cor de destaque
    im(['-size', `${W}x${H}`, `xc:${c0}`,
      '(', '-size', `${W}x${H}`, `radial-gradient:${c1}-none`, '-channel', 'A', '-evaluate', 'multiply', '0.30', '+channel', ')',
      '-compose', 'over', '-composite', bg])
    // avatar circular com anel
    im(['-size', `${AV}x${AV}`, 'xc:none', '-fill', 'white', '-draw', `circle ${AV / 2},${AV / 2} ${AV / 2},2`, mask])
    im(['(', img, ...(_cover(AV, AV)), ')', mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', av])
    im([bg,
      // anel branco atrás do avatar
      '-fill', c1, '-draw', `circle ${W / 2},230 ${W / 2},${230 - AV / 2 - 8}`,
      av, '-gravity', 'north', '-geometry', `+0+${230 - AV / 2}`, '-composite',
      '-gravity', 'center', '-font', font,
      '-fill', c1, '-pointsize', '54', '-annotate', '+0+120', titulo_,
      '-fill', 'white', '-pointsize', '78', '-annotate', '+0+200', quem,
      ...(subt ? ['-fill', '#dbe4ee', '-pointsize', '36', '-annotate', '+0+275', subt] : []),
      out])
    return { out }
  } finally { limpar() }
}

// ── /quote?img=&texto=&autor= → citação estilo "make it a quote" ───────────
export function gerarQuote({ img, texto, autor, imBin, font, dir, out }) {
  const { nt, im, limpar } = _ctx(imBin, dir)
  const W = 1000, H = 500
  const frase = _txt(texto, 220) || '...'
  const quem = _txt(autor, 26)
  try {
    const foto = nt(), fade = nt(), fundida = nt(), bg = nt(), txt = nt()
    // foto a P&B no lado esquerdo
    im(['(', img, ...(_cover(H, H)), '-colorspace', 'Gray', ')', foto])
    // máscara horizontal: opaco à esquerda → transparente à direita (funde no preto)
    im(['-size', `${H}x${H}`, 'gradient:white-black', fade])
    im([foto, fade, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', fundida])
    // fundo preto + foto fundida à esquerda
    im(['-size', `${W}x${H}`, 'xc:black', fundida, '-gravity', 'west', '-composite', bg])
    // texto branco (auto-fit) no lado direito
    im(['-background', 'none', '-fill', 'white', '-font', font, '-size', `${W - H - 80}x${H - 160}`, '-gravity', 'center', `caption:“${frase}”`, txt])
    const a = [bg, txt, '-gravity', 'east', '-geometry', '+40+-30', '-composite']
    if (quem) a.push('-gravity', 'southeast', '-font', font, '-fill', '#bbbbbb', '-pointsize', '34', '-annotate', '+50+40', `— ${quem}`)
    a.push(out)
    im(a)
    return { out }
  } finally { limpar() }
}
