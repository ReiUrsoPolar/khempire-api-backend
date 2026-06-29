// logo.js — gera logos de texto BONITOS com ImageMagick (auto-hospedado).
// Três modos: neon (brilho aditivo + núcleo branco), metal (gradiente preso ao
// texto + contorno + sombra) e 3d (extrusão). Partilhado pelo endpoint /logo e
// pelo script de pré-visualização. Recebe os binários/fonte por parâmetro para
// poder ser testado fora da VPS.
import { execFileSync } from 'child_process'
import { unlinkSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

// neon  → cor sólida com brilho forte (neon/matrix/blood/azul/rosa/roxo/branco)
// metal → texto preenchido com gradiente suave (fire/fogo, ouro/gold, cromado, rainbow)
// 3d    → letras com extrusão (profundidade)
export const LOGO_ESTILOS = {
  neon:    { tipo: 'neon',  cor: '#19e6ff' },
  matrix:  { tipo: 'neon',  cor: '#27ff5e' },
  blood:   { tipo: 'neon',  cor: '#ff2222' },
  azul:    { tipo: 'neon',  cor: '#3b82f6' },
  rosa:    { tipo: 'neon',  cor: '#ff4fa3' },
  roxo:    { tipo: 'neon',  cor: '#b06bff' },
  branco:  { tipo: 'neon',  cor: '#ffffff' },
  fire:    { tipo: 'metal', dir: 'v', cores: ['#ffe23a', '#ff7b00', '#c40000'] },
  fogo:    { tipo: 'metal', dir: 'v', cores: ['#ffe23a', '#ff7b00', '#c40000'] },
  ouro:    { tipo: 'metal', dir: 'v', cores: ['#6b4a00', '#ffd34d', '#fff3c0', '#ffcb2e', '#7a5200'] },
  gold:    { tipo: 'metal', dir: 'v', cores: ['#6b4a00', '#ffd34d', '#fff3c0', '#ffcb2e', '#7a5200'] },
  cromado: { tipo: 'metal', dir: 'v', cores: ['#dfe7ee', '#9aa6b2', '#2f3740', '#eef4fa', '#8893a0'] },
  chrome:  { tipo: 'metal', dir: 'v', cores: ['#dfe7ee', '#9aa6b2', '#2f3740', '#eef4fa', '#8893a0'] },
  rainbow: { tipo: 'metal', dir: 'h', cores: ['#ff2b2b', '#ff9b1a', '#ffe81a', '#3ad14b', '#1ea0ff', '#9b4dff'] },
  '3d':    { tipo: '3d',    cor: '#ffd34d' },
}

export const LOGO_NOMES = Object.keys(LOGO_ESTILOS)

// Constrói os args ImageMagick do FUNDO do logo:
//  · 'transparente' → sem fundo (PNG transparente, bom p/ overlays/stickers)
//  · '#rrggbb' / nome de cor → cor sólida
//  · (default) → vinheta escura (spotlight) que dá profundidade sem matar o brilho
function _fundoArgs(fundo, W, H) {
  const f = String(fundo || '').trim().toLowerCase()
  if (f === 'transparente' || f === 'transparent' || f === 'nenhum') return ['-size', `${W}x${H}`, 'xc:none']
  if (/^#?[0-9a-f]{6}$/i.test(f)) return ['-size', `${W}x${H}`, `xc:${f[0] === '#' ? f : '#' + f}`]
  if (f === 'preto' || f === 'black') return ['-size', `${W}x${H}`, 'xc:black']
  return ['-size', `${W}x${H}`, 'radial-gradient:#1d1f24-#000000']
}

// Gera o PNG do logo em `out`. Lança em caso de falha. Limpa sempre os temporários.
// `fundo` (opcional): 'transparente' | '#rrggbb' | 'preto' | (default vinheta).
export function gerarLogo({ texto, estilo, imBin, idBin, font, dir, out, fundo }) {
  const W = 1280, H = 640
  const txt = String(texto || '').replace(/[\r\n\f\\%]+/g, ' ').replace(/^[@\-]+/, '').slice(0, 30).trim() || 'Texto'
  const st  = LOGO_ESTILOS[String(estilo || 'neon').toLowerCase()] || LOGO_ESTILOS.neon
  const fs  = Math.max(56, Math.min(220, Math.floor(1300 / Math.max(txt.length, 1))))

  const tmp = []
  const nt  = () => { const p = join(dir, randomBytes(8).toString('hex') + '.png'); tmp.push(p); return p }
  const im  = (args) => execFileSync(imBin, args, { stdio: 'ignore', timeout: 15_000 })
  const usaMagick = /magick(\.exe)?$/i.test(idBin)
  const ident = (f) => execFileSync(idBin, usaMagick ? ['identify', '-format', '%w %h', f] : ['-format', '%w %h', f], { timeout: 8_000 }).toString().trim()

  try {
    const txtC = nt(), txtP = nt(), bg = nt()
    // fundo (vinheta por defeito) — primeiro para servir de base aos composites
    im([..._fundoArgs(fundo, W, H), bg])
    // texto branco centrado (canvas inteiro) + versão recortada (bounding box)
    im(['-size', `${W}x${H}`, 'xc:none', '-gravity', 'center', '-font', font, '-pointsize', String(fs), '-fill', 'white', '-annotate', '+0+0', txt, txtC])
    im([txtC, '-trim', '+repage', txtP])
    let tw = 600, th = 200
    try { const d = ident(txtP).split(/\s+/); tw = parseInt(d[0]) || 600; th = parseInt(d[1]) || 200 } catch {}

    if (st.tipo === 'neon') {
      const face = nt(), core = nt()
      im([txtC, '-fill', st.cor, '-colorize', '100', face])
      im([txtC, '-fill', 'white', '-colorize', '100', '-blur', '0x1.2', core])
      im([bg,
        '(', face, '-blur', '0x30', ')', '-compose', 'screen', '-composite',
        '(', face, '-blur', '0x15', ')', '-compose', 'screen', '-composite',
        '(', face, '-blur', '0x6',  ')', '-compose', 'screen', '-composite',
        face, '-compose', 'over', '-composite',
        core, '-compose', 'screen', '-composite',
        out])
    } else if (st.tipo === 'metal') {
      const grad = nt(), face = nt(), faceC = nt(), outl = nt()
      const app = st.dir === 'h' ? '+append' : '-append'
      im(['(', ...st.cores.map(c => `xc:${c}`), app, ')', '-filter', 'Triangle', '-resize', `${tw}x${th}!`, grad])
      im([grad, txtP, '-compose', 'CopyOpacity', '-composite', face])
      im(['-size', `${W}x${H}`, 'xc:none', face, '-gravity', 'center', '-composite', faceC])
      im([txtC, '-channel', 'A', '-morphology', 'Dilate', 'Disk:3', '+channel', '-fill', 'black', '-colorize', '100', outl])
      im([bg, '-compose', 'over',
        '(', outl, '-background', 'black', '-shadow', '90x8+0+12', ')', '-gravity', 'center', '-composite',
        outl,  '-gravity', 'center', '-composite',
        faceC, '-gravity', 'center', '-composite',
        out])
    } else { // 3d — extrusão
      const face = nt()
      im([txtC, '-fill', st.cor, '-colorize', '100', face])
      const a = [bg, '-compose', 'over']
      for (let i = 14; i >= 1; i--) a.push('(', txtC, '-fill', '#222a33', '-colorize', '100', ')', '-gravity', 'center', '-geometry', `+${i}+${i}`, '-composite')
      a.push(face, '-gravity', 'center', '-composite', out)
      im(a)
    }
    return out
  } finally {
    for (const f of tmp) { try { unlinkSync(f) } catch {} }
  }
}

// ── /ttp — figurinha de TEXTO (webp 512x512) — substitui attp/brat/white da Bronxys ──
// Estilos: white (texto preto/fundo branco), preto, brat (verde-lima, minúsculas,
// leve blur — estilo do álbum "brat"), attp/rainbow (texto arco-íris, fundo
// transparente). O caption: ajusta o tamanho da fonte para caber no quadrado.
export function gerarTtp({ texto, estilo, imBin, font, dir, out }) {
  const S = 512
  const txt = String(texto || '').replace(/[\r\n\f\\%]+/g, ' ').replace(/^[@\-]+/, '').slice(0, 60).trim() || 'texto'
  const est = String(estilo || 'white').toLowerCase()
  const tmp = []
  const nt  = () => { const p = join(dir, randomBytes(8).toString('hex') + '.png'); tmp.push(p); return p }
  const im  = (args) => execFileSync(imBin, args, { stdio: 'ignore', timeout: 15_000 })
  // figurinha simples: caption (auto-fit) sobre fundo, recortado a 512x512
  const simples = (bg, fill, txtv, extra = []) =>
    im(['-background', bg, '-fill', fill, '-font', font, '-size', `${S - 60}x${S - 80}`, '-gravity', 'center', `caption:${txtv}`, '-gravity', 'center', '-extent', `${S}x${S}`, ...extra, out])
  try {
    if (est === 'brat') {
      simples('#8ACE00', 'black', txt.toLowerCase(), ['-blur', '0x1.3'])
    } else if (est === 'preto' || est === 'black') {
      simples('black', 'white', txt)
    } else if (est === 'attp' || est === 'rainbow') {
      const mask = nt(), grad = nt()
      im(['-background', 'none', '-fill', 'white', '-font', font, '-size', `${S - 60}x${S - 80}`, '-gravity', 'center', `caption:${txt}`, '-gravity', 'center', '-extent', `${S}x${S}`, mask])
      im(['(', 'xc:#ff2b2b', 'xc:#ff9b1a', 'xc:#ffe81a', 'xc:#3ad14b', 'xc:#1ea0ff', 'xc:#9b4dff', '+append', ')', '-filter', 'Triangle', '-resize', `${S}x${S}!`, grad])
      im([grad, mask, '-compose', 'CopyOpacity', '-composite', out])
    } else { // white (default)
      simples('white', 'black', txt)
    }
    return out
  } finally {
    for (const f of tmp) { try { unlinkSync(f) } catch {} }
  }
}

// ── /theme — cartão personalizado bonito (gradiente + vinheta + nome com brilho) ──
export const THEME_ESTILOS = {
  polar:  ['#0a2540', '#00e0ff'], neon: ['#7c3aed', '#ff2d95'], fogo: ['#ff512f', '#f09819'],
  matrix: ['#05140a', '#00ff66'], ouro: ['#1a1408', '#ffd700'], roxo: ['#2b0a4d', '#c44eff'],
  oceano: ['#000428', '#4364f7'], rosa: ['#ff0844', '#ffb199'], verde: ['#0f2027', '#2bff88'],
  preto:  ['#101317', '#3a4250'], vermelho: ['#2a0606', '#ff3b3b'], azul: ['#06122a', '#3b82f6'],
}
export const THEME_NOMES = Object.keys(THEME_ESTILOS)

// Cartão 1280x720: gradiente diagonal + vinheta + nome grande (sombra+brilho na
// cor de destaque) + subtítulo opcional + linha de destaque. Lança em falha.
export function gerarTheme({ texto, sub, estilo, imBin, font, dir, out }) {
  const W = 1280, H = 720
  const nome = String(texto || '').replace(/[\r\n\f\\%]+/g, ' ').replace(/^[@\-]+/, '').slice(0, 24).trim() || 'Polar'
  const subt = String(sub || '').replace(/[\r\n\f\\%]+/g, ' ').replace(/^[@\-]+/, '').slice(0, 40).trim()
  const [c0, c1] = THEME_ESTILOS[String(estilo || 'polar').toLowerCase()] || THEME_ESTILOS.polar
  const fsN = Math.max(60, Math.min(170, Math.floor(1500 / Math.max(nome.length, 1))))
  const offN = subt ? -34 : 0

  const tmp = []
  const nt  = () => { const p = join(dir, randomBytes(8).toString('hex') + '.png'); tmp.push(p); return p }
  const im  = (args) => execFileSync(imBin, args, { stdio: 'ignore', timeout: 15_000 })

  try {
    const bg = nt(), nameImg = nt()
    const offNome = subt ? -46 : -6
    // 1) fundo: c0 escuro + foco radial suave na cor de destaque (spotlight)
    im(['-size', `${W}x${H}`, `xc:${c0}`,
        '(', '-size', `${W}x${H}`, `radial-gradient:${c1}-none`, '-channel', 'A', '-evaluate', 'multiply', '0.32', '+channel', ')',
        '-compose', 'over', '-composite', bg])
    // 2) nome em branco (camada para sombra + brilho subtil), centrado e subido se houver subtítulo
    im(['-size', `${W}x${H}`, 'xc:none', '-gravity', 'center', '-font', font, '-pointsize', String(fsN), '-fill', 'white', '-annotate', `+0+${offNome}`, nome, nameImg])
    // 3) compor: fundo + brilho subtil (destaque) + sombra nítida + nome branco
    const a = [bg, '-compose', 'over',
      '(', nameImg, '-fill', c1, '-colorize', '100', '-blur', '0x9', ')', '-gravity', 'center', '-compose', 'screen', '-composite',
      '(', nameImg, '-background', 'black', '-shadow', '70x5+0+6', ')', '-gravity', 'center', '-compose', 'over', '-composite',
      nameImg, '-gravity', 'center', '-compose', 'over', '-composite', '-compose', 'over']
    // 4) linha de destaque + subtítulo, claramente por baixo do nome
    const lineY = Math.round(H / 2 + (subt ? 30 : 70))
    a.push('-fill', c1, '-draw', `roundrectangle ${W / 2 - 80},${lineY} ${W / 2 + 80},${lineY + 7} 3,3`)
    if (subt) a.push('-gravity', 'center', '-font', font, '-pointsize', '40', '-fill', '#e8eef5', '-annotate', `+0+${Math.round(H * 0.13)}`, subt)
    a.push(out)
    im(a)
    return out
  } finally {
    for (const f of tmp) { try { unlinkSync(f) } catch {} }
  }
}
