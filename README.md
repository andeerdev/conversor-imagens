# Conversor de Imagens

Semana 01 do [Desafio 12x12](https://andeerdev.github.io/desafio-12x12/): um projeto lançado por semana até o fim de 2026.

Converta imagens para WebP, JPG ou PNG direto no navegador. Ajuste a qualidade e o tamanho, veja o antes e depois de cada arquivo e baixe tudo de uma vez num `.zip`. **Nenhuma imagem é enviada para servidor nenhum**: a conversão acontece no seu computador ou celular.

**[Abrir o conversor →](https://andeerdev.github.io/conversor-imagens/)**

## O que ele faz

- **Entradas:** JPG, PNG, WebP, GIF, BMP, SVG, AVIF e HEIC (fotos de iPhone). Dá para arrastar, escolher arquivos ou colar com Ctrl+V.
- **Saídas:** WebP, JPG ou PNG, com qualidade ajustável de 10 a 100.
- **Redimensionamento:** tamanho original, largura máxima em pixels ou porcentagem. A proporção é mantida e nada é ampliado.
- **Antes e depois:** tamanho, dimensões e a economia de cada arquivo e do total.
- **EXIF:** a rotação das fotos de celular é aplicada, e os metadados da câmera (local, modelo, data) não vão para a saída.
- **Cor de fundo:** ao converter para JPG, as áreas transparentes recebem a cor que você escolher.
- **ZIP:** baixe tudo num arquivo só, com nomes sem repetição.
- **Configurações lembradas:** formato, qualidade e tamanho ficam salvos no navegador.

## Como funciona

1. **Decodificar:** cada arquivo vira um `ImageBitmap` com `createImageBitmap(..., { imageOrientation: "from-image" })`. HEIC passa antes pelo [heic2any](https://github.com/alexcorvi/heic2any), carregado só quando aparece um.
2. **Desenhar no canvas:** a imagem é reduzida em etapas (metade por vez) até chegar perto do tamanho final, o que evita serrilhado em reduções grandes.
3. **Exportar:** `canvas.toBlob()` gera o arquivo no formato e na qualidade escolhidos.
4. **Empacotar:** o [JSZip](https://stuk.github.io/jszip/) monta o `.zip` sem compressão, porque as imagens já vêm comprimidas.

Os arquivos são processados **um por vez**. Várias fotos de 12 MP ao mesmo tempo estouram a memória do celular. Ao mudar a configuração, tudo é reconvertido a partir da imagem já decodificada.

## Limitações conhecidas

- GIF animado vira imagem estática (só o primeiro quadro).
- Não há saída em AVIF, porque o suporte do canvas a esse formato ainda é inconsistente entre navegadores.
- O Safari antigo não gera WebP. Nesse caso, a opção fica desabilitada.
- A saída é limitada a 16 megapixels, o limite seguro de canvas no Safari do iPhone.

## Rodar localmente

Não tem build nem dependências para instalar. Basta servir a pasta:

```bash
python -m http.server 8000
```

E abra http://localhost:8000.

## Estrutura

```
conversor-imagens/
├── index.html
├── assets/
│   ├── styles.css
│   └── app.js                 # toda a lógica
├── vendor/
│   ├── jszip.min.js           # JSZip 3.10.1
│   ├── heic2any.min.js        # heic2any 0.0.4, carregado sob demanda
│   └── LICENSE-*.md           # licenças das bibliotecas
└── .github/workflows/deploy.yml
```

## Licença

[MIT](./LICENSE) © 2026 Anderson Ferreira.

As bibliotecas em `vendor/` mantêm as próprias licenças, copiadas ao lado delas: JSZip (MIT ou GPLv3, usado aqui sob MIT) e heic2any (MIT). O heic2any embute uma versão compilada do [libheif](https://github.com/strukturag/libheif), que é LGPL-3.0.
