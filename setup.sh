#!/usr/bin/env bash
# Setup automático da KH Empire API (backend) numa VPS Ubuntu/Debian (como root).
# Instala Node 20 + ffmpeg + Caddy (HTTPS automático) + pm2, e põe a app a correr.
#
# USO (na VPS, dentro da pasta do repo):
#   export SHARD_SECRET="o-segredo-que-o-claude-deu"
#   export DOMINIO="api-backend.thekhempire.com"      # subdomínio que aponta p/ esta VPS
#   bash setup.sh
#
# (O DOMINIO TEM de resolver para o IP desta VPS ANTES de correr — senão o Caddy
#  não consegue tirar o certificado HTTPS.)
set -e

: "${SHARD_SECRET:?Define SHARD_SECRET antes de correr (export SHARD_SECRET=...)}"
: "${DOMINIO:?Define DOMINIO antes de correr (export DOMINIO=api-backend.teudominio.com)}"
PORT="${PORT:-3000}"

echo "==> A instalar Node 20, git e ffmpeg..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git ffmpeg

echo "==> A instalar o Caddy (HTTPS automático)..."
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update && apt-get install -y caddy

echo "==> A instalar dependências da app (inclui yt-dlp)..."
npm install
npm install -g pm2

echo "==> A arrancar a app com pm2 (porta $PORT)..."
SHARD_SECRET="$SHARD_SECRET" PORT="$PORT" pm2 start src/index.js --name khapi --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> A configurar o Caddy ($DOMINIO -> localhost:$PORT)..."
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
  reverse_proxy localhost:$PORT
}
EOF
systemctl restart caddy

echo ""
echo "================================================================"
echo "PRONTO! Testa no browser:  https://$DOMINIO/health"
echo "Deve responder: {\"ok\":true,...}"
echo "Depois dá este URL ao Claude para ligar ao Worker."
echo "================================================================"
