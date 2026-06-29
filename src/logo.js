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

// Gera o PNG do logo em `out`. Lança em caso de falha. Limpa sempre os temporários.
export function gerarLogo({ texto, estilo, imBin, idBin, font, dir, out }) {
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
    const txtC = nt(), txtP = nt()
    // texto branco centrado (canvas inteiro) + versão recortada (bounding box)
    im(['-size', `${W}x${H}`, 'xc:none', '-gravity', 'center', '-font', font, '-pointsize', String(fs), '-fill', 'white', '-annotate', '+0+0', txt, txtC])
    im([txtC, '-trim', '+repage', txtP])
    let tw = 600, th = 200
    try { const d = ident(txtP).split(/\s+/); tw = parseInt(d[0]) || 600; th = parseInt(d[1]) || 200 } catch {}

    if (st.tipo === 'neon') {
      const face = nt(), core = nt()
      im([txtC, '-fill', st.cor, '-colorize', '100', face])
      im([txtC, '-fill', 'white', '-colorize', '100', '-blur', '0x1.2', core])
      im(['-size', `${W}x${H}`, 'xc:black',
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
      im(['-size', `${W}x${H}`, 'xc:black',
        '(', outl, '-background', 'black', '-shadow', '90x8+0+12', ')', '-gravity', 'center', '-composite',
        outl,  '-gravity', 'center', '-composite',
        faceC, '-gravity', 'center', '-composite',
        out])
    } else { // 3d — extrusão
      const face = nt()
      im([txtC, '-fill', st.cor, '-colorize', '100', face])
      const a = ['-size', `${W}x${H}`, 'xc:black']
      for (let i = 14; i >= 1; i--) a.push('(', txtC, '-fill', '#222a33', '-colorize', '100', ')', '-gravity', 'center', '-geometry', `+${i}+${i}`, '-composite')
      a.push(face, '-gravity', 'center', '-composite', out)
      im(a)
    }
    return out
  } finally {
    for (const f of tmp) { try { unlinkSync(f) } catch {} }
  }
}
