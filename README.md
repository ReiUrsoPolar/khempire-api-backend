# KH Empire API — backend (ShardCloud)

App Node que corre os **endpoints pesados** da [KH Empire API](https://thekhempire.com/api)
(downloads, etc.). Não valida chaves nem cobra créditos — isso é o **Worker** (portaria).
Esta app **só** responde a quem traz o header `X-Internal-Secret` igual ao `SHARD_SECRET`
(ou seja, só o Worker). O público nunca lhe chama diretamente.

```
Dev → Worker (thekhempire.com/api/v1/dl) → [valida chave + saldo] → este backend (/dl) → resultado
```

## Variáveis de ambiente

| Var | Obrigatória | O que é |
|-----|-------------|---------|
| `PORT` | (a host normalmente define) | Porta onde a app escuta. Default 3000. |
| `SHARD_SECRET` | **Sim** | Password partilhada com o Worker. Sem ela, a app recusa tudo (503). Põe a MESMA no Worker. |

## Correr localmente

```bash
npm install
SHARD_SECRET=umsegredoforte npm start
# teste:
curl http://localhost:3000/health
curl "http://localhost:3000/dl?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" -H "X-Internal-Secret: umsegredoforte"
```

## Deploy na ShardCloud

1. Sobe como **app/site** (que escuta numa porta e ganha um **URL público HTTPS**), não como "bot".
2. Define a env **`SHARD_SECRET`** (um segredo forte; guarda-o — vais pô-lo igual no Worker).
3. Garante que a host corre `npm install` e depois `npm start` (script `start` já existe).
   - Se a ShardCloud pedir um ficheiro de config próprio (memória, ficheiro principal), aponta para
     `src/index.js` / `npm start` e ~2 GB de RAM.
4. Confirma que `https://O-TEU-URL/health` responde `{ "ok": true }`.
5. Dá o URL ao Worker:
   - `SHARD_URL` = `https://O-TEU-URL` (var no `wrangler.toml` do polar-backend, ou secret)
   - `SHARD_SECRET` = o mesmo segredo (secret no Worker: `npx wrangler secret put SHARD_SECRET`)
6. A partir daí, `https://thekhempire.com/api/v1/dl?url=…&apikey=…` passa a funcionar.

## Endpoints (crescem com o tempo)

- `GET /dl?url=<link>&format=video|audio` — info + URL direto do media (yt-dlp).

> Próximos: stickers (sharp/ffmpeg), pesquisa, diversão.
