/* ==========================================================================
   Conversor de Imagens · Semana 01 do Desafio 12x12
   Tudo roda no navegador: decodifica, redesenha num canvas e exporta.
   Nenhum arquivo sai da máquina de quem usa.
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "conversor-imagens:config";
  const MAX_PIXELS = 16_000_000; // limite seguro de canvas no Safari do iPhone
  const THUMB = 112;             // exibida em 56 px: nítida em tela retina
  const DEBOUNCE_MS = 250;

  const DEFAULTS = {
    fmt: "image/webp",
    quality: 82,
    resize: "original",
    maxWidth: 1920,
    percent: 50,
    bg: "#ffffff",
  };

  const EXT = { "image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png" };

  const FMT_NOTES = {
    "image/webp": "Menor tamanho na maioria dos casos. Funciona em todos os navegadores atuais.",
    "image/jpeg": "Compatível com tudo. Bom para fotos, sem transparência.",
    "image/png": "Sem perda de qualidade e com transparência. Os arquivos ficam maiores.",
  };
  const NO_WEBP_NOTE = "Este navegador não gera WebP. Use JPG ou PNG, ou abra no Chrome, Edge ou Firefox.";

  const ICONS = {
    download: ["M12 4v12m0 0l-5-5m5 5l5-5", "M5 20h14"],
    remove: ["M6 6l12 12", "M18 6L6 18"],
  };

  const $ = (id) => document.getElementById(id);

  const el = {
    drop: $("drop"),
    file: $("file"),
    summary: $("summary"),
    sumCount: $("sum-count"),
    sumBefore: $("sum-before"),
    sumAfter: $("sum-after"),
    sumSaving: $("sum-saving"),
    clear: $("clear"),
    zip: $("zip"),
    empty: $("empty"),
    list: $("list"),
    fmtNote: $("fmt-note"),
    qualityField: $("quality-field"),
    quality: $("quality"),
    qualityOut: $("quality-out"),
    widthField: $("width-field"),
    maxWidth: $("max-width"),
    percentField: $("percent-field"),
    percent: $("percent"),
    bgField: $("bg-field"),
    bg: $("bg"),
    toast: $("toast"),
  };

  const state = {
    items: [],      // { id, file, status, statusText, decoded, out, thumbUrl, li, refs }
    nextId: 1,
    gen: 0,         // incrementa a cada mudança de configuração
    running: false, // a fila está processando?
    webpOk: true,   // o navegador gera WebP?
    zipping: false,
  };

  const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

  /* ---------- Utilidades ---------- */

  function formatBytes(bytes) {
    if (bytes < 1024) return `${nf.format(bytes)} B`;
    if (bytes < 1024 * 1024) return `${nf.format(bytes / 1024)} KB`;
    return `${nf.format(bytes / (1024 * 1024))} MB`;
  }

  // −73% quando diminuiu, +12% quando aumentou.
  function formatDelta(before, after) {
    const pct = Math.round(((after - before) / before) * 100);
    if (pct < 0) return { text: `−${-pct}%`, cls: "is-good", title: "Menor que o original" };
    if (pct > 0) return { text: `+${pct}%`, cls: "is-bad", title: "Maior que o original" };
    return { text: "0%", cls: "", title: "" };
  }

  function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function isHeic(file) {
    return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  }

  function isImage(file) {
    return file.type.startsWith("image/") || isHeic(file);
  }

  function baseName(name) {
    const dot = name.lastIndexOf(".");
    const base = (dot > 0 ? name.slice(0, dot) : name).trim();
    return base || "imagem";
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function newCanvas(w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return { canvas, ctx };
  }

  function downloadUrl(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  let toastTimer = 0;
  function toast(message) {
    el.toast.hidden = false;
    el.toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3000);
  }

  function icon(paths) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of paths) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    }
    return svg;
  }

  /* ---------- Configuração ---------- */

  function checkedValue(name) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    return input ? input.value : DEFAULTS[name];
  }

  function readConfig() {
    const bg = el.bg.value;
    return {
      fmt: checkedValue("fmt"),
      quality: clampInt(el.quality.value, 10, 100, DEFAULTS.quality),
      resize: checkedValue("resize"),
      maxWidth: clampInt(el.maxWidth.value, 16, 10000, DEFAULTS.maxWidth),
      percent: clampInt(el.percent.value, 1, 100, DEFAULTS.percent),
      bg: /^#[0-9a-f]{6}$/i.test(bg) ? bg : DEFAULTS.bg,
    };
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readConfig()));
    } catch (_) {
      // Aba anônima ou armazenamento bloqueado: segue sem lembrar.
    }
  }

  function loadConfig() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) {
      saved = null;
    }
    if (!saved || typeof saved !== "object") return;

    const check = (name, value) => {
      if (typeof value !== "string") return;
      const input = Array.from(document.querySelectorAll(`input[name="${name}"]`))
        .find((i) => i.value === value);
      if (input && !input.disabled) input.checked = true;
    };
    check("fmt", saved.fmt);
    check("resize", saved.resize);
    el.quality.value = clampInt(saved.quality, 10, 100, DEFAULTS.quality);
    el.maxWidth.value = clampInt(saved.maxWidth, 16, 10000, DEFAULTS.maxWidth);
    el.percent.value = clampInt(saved.percent, 1, 100, DEFAULTS.percent);
    if (typeof saved.bg === "string" && /^#[0-9a-f]{6}$/i.test(saved.bg)) el.bg.value = saved.bg;
  }

  function syncPanel() {
    const cfg = readConfig();
    el.qualityOut.value = String(cfg.quality);
    el.qualityField.hidden = cfg.fmt === "image/png";
    el.widthField.hidden = cfg.resize !== "width";
    el.percentField.hidden = cfg.resize !== "percent";
    el.bgField.hidden = cfg.fmt !== "image/jpeg";
    el.fmtNote.textContent = state.webpOk ? FMT_NOTES[cfg.fmt] : NO_WEBP_NOTE;
    el.fmtNote.classList.toggle("is-warn", !state.webpOk);
  }

  let configTimer = 0;
  function onConfigChange() {
    syncPanel();
    saveConfig();
    clearTimeout(configTimer);
    configTimer = setTimeout(() => {
      state.gen++;
      for (const item of state.items) {
        if (item.status === "error" && !item.decoded) continue; // falhou ao ler: não adianta refazer
        if (item.status === "working") continue;                 // a fila percebe a mudança pelo gen
        item.status = "queued";
        renderItem(item);
      }
      renderSummary();
      runQueue();
    }, DEBOUNCE_MS);
  }

  function detectWebp() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      return canvas.toDataURL("image/webp").startsWith("data:image/webp");
    } catch (_) {
      return false;
    }
  }

  /* ---------- Decodificação ---------- */

  let heicPromise = null;
  function loadHeic2any() {
    if (typeof window.heic2any === "function") return Promise.resolve(window.heic2any);
    if (!heicPromise) {
      heicPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "./vendor/heic2any.min.js";
        script.async = true;
        script.onload = () => {
          if (typeof window.heic2any === "function") resolve(window.heic2any);
          else reject(new Error("Não foi possível carregar o leitor de HEIC. Recarregue a página."));
        };
        script.onerror = () => {
          script.remove();
          reject(new Error("Não foi possível carregar o leitor de HEIC. Verifique a conexão e tente de novo."));
        };
        document.head.appendChild(script);
      }).catch((err) => {
        heicPromise = null; // permite tentar de novo
        throw err;
      });
    }
    return heicPromise;
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        // SVG sem width/height chega com tamanho natural 0.
        resolve({ source: img, w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Formato não suportado por este navegador."));
      };
      img.src = url;
    });
  }

  async function decode(item) {
    let blob = item.file;

    if (isHeic(item.file)) {
      item.statusText = "Lendo HEIC…";
      renderItem(item);
      const heic2any = await loadHeic2any();
      try {
        const result = await heic2any({ blob, toType: "image/png" });
        blob = Array.isArray(result) ? result[0] : result;
      } catch (_) {
        throw new Error("Não foi possível ler este HEIC. O arquivo pode estar corrompido.");
      }
    }

    const isSvg = blob.type === "image/svg+xml" || /\.svg$/i.test(item.file.name);
    if (!isSvg && typeof createImageBitmap === "function") {
      try {
        // from-image aplica a rotação EXIF das fotos de celular.
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        return { source: bitmap, w: bitmap.width, h: bitmap.height };
      } catch (_) {
        // cai para o <img>
      }
    }
    return loadImage(blob);
  }

  function releaseDecoded(decoded) {
    if (decoded && decoded.source && typeof decoded.source.close === "function") decoded.source.close();
  }

  // Reduz pela metade enquanto a imagem for mais que o dobro do destino.
  // Evita serrilhado em reduções grandes (4000 px para 400 px).
  function stepDown(source, w, h, tw, th) {
    let current = source;
    let cw = w;
    let ch = h;
    let previous = null;
    while (cw > tw * 2 && ch > th * 2) {
      const nw = Math.max(1, Math.round(cw / 2));
      const nh = Math.max(1, Math.round(ch / 2));
      const { canvas, ctx } = newCanvas(nw, nh);
      ctx.drawImage(current, 0, 0, nw, nh);
      if (previous) previous.width = previous.height = 0;
      previous = canvas;
      current = canvas;
      cw = nw;
      ch = nh;
    }
    return {
      image: current,
      release() { if (previous) previous.width = previous.height = 0; },
    };
  }

  async function makeThumb(decoded) {
    const { source, w, h } = decoded;
    const scale = Math.max(THUMB / w, THUMB / h);
    const dw = w * scale;
    const dh = h * scale;
    const { canvas, ctx } = newCanvas(THUMB, THUMB);
    const step = stepDown(source, w, h, dw, dh);
    ctx.drawImage(step.image, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);
    step.release();
    const blob = await toBlob(canvas, "image/png");
    canvas.width = canvas.height = 0;
    return blob ? URL.createObjectURL(blob) : "";
  }

  /* ---------- Conversão ---------- */

  function outputSize(w, h, cfg) {
    let scale = 1;
    if (cfg.resize === "width" && w > cfg.maxWidth) scale = cfg.maxWidth / w; // nunca amplia
    if (cfg.resize === "percent") scale = cfg.percent / 100;
    return {
      tw: Math.max(1, Math.round(w * scale)),
      th: Math.max(1, Math.round(h * scale)),
    };
  }

  async function convert(item, cfg) {
    const { source, w, h } = item.decoded;
    const { tw, th } = outputSize(w, h, cfg);
    if (tw * th > MAX_PIXELS) {
      throw new Error(`Imagem grande demais (${tw}×${th}). Reduza o tamanho de saída.`);
    }

    const { canvas, ctx } = newCanvas(tw, th);
    if (cfg.fmt === "image/jpeg") {
      // JPG não tem transparência: sem fundo, as áreas vazias viram preto.
      ctx.fillStyle = cfg.bg;
      ctx.fillRect(0, 0, tw, th);
    }
    const step = stepDown(source, w, h, tw, th);
    ctx.drawImage(step.image, 0, 0, tw, th);
    step.release();

    const quality = cfg.fmt === "image/png" ? undefined : cfg.quality / 100;
    const blob = await toBlob(canvas, cfg.fmt, quality);
    canvas.width = canvas.height = 0;

    if (blob === null) throw new Error("O navegador não conseguiu gerar a imagem. Tente um tamanho menor.");
    // O Safari antigo devolve PNG em silêncio quando se pede WebP.
    if (blob.type !== cfg.fmt) throw new Error("Este navegador não gera esse formato. Escolha outro.");

    return { blob, url: "", w: tw, h: th, name: baseName(item.file.name) + EXT[cfg.fmt] };
  }

  /* ---------- Fila (um arquivo por vez) ---------- */

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function runQueue() {
    if (state.running) return;
    state.running = true;
    renderSummary();

    let item;
    while ((item = state.items.find((i) => i.status === "queued"))) {
      const gen = state.gen;
      item.status = "working";
      item.statusText = "Convertendo…";
      renderItem(item);

      try {
        if (!item.decoded) {
          const decoded = await decode(item);
          if (item.removed) { releaseDecoded(decoded); continue; }
          item.decoded = decoded;
          const thumbUrl = await makeThumb(decoded);
          if (item.removed) { URL.revokeObjectURL(thumbUrl); continue; }
          item.thumbUrl = thumbUrl;
          item.statusText = "Convertendo…";
          renderItem(item);
        }

        const out = await convert(item, readConfig());
        if (item.removed) continue;
        if (gen !== state.gen) { item.status = "queued"; continue; } // configuração mudou: refaz

        if (item.out) URL.revokeObjectURL(item.out.url);
        out.url = URL.createObjectURL(out.blob);
        item.out = out;
        item.status = "done";
        item.statusText = "";
      } catch (err) {
        if (item.removed) continue;
        item.status = "error";
        item.statusText = (err && err.message) || "Não foi possível converter esta imagem.";
      }

      renderItem(item);
      renderSummary();
      await tick(); // devolve o controle para a interface não travar
    }

    state.running = false;
    renderSummary();
  }

  /* ---------- Entrada de arquivos ---------- */

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const accepted = files.filter(isImage);
    const ignored = files.length - accepted.length;
    if (ignored === 1) toast("1 arquivo ignorado: não é imagem.");
    else if (ignored > 1) toast(`${ignored} arquivos ignorados: não são imagens.`);

    for (const file of accepted) {
      const item = {
        id: state.nextId++,
        file,
        status: "queued",
        statusText: "",
        decoded: null,
        out: null,
        thumbUrl: "",
        li: null,
        refs: null,
        removed: false,
      };
      buildItem(item);
      state.items.push(item);
      el.list.appendChild(item.li);
      renderItem(item);
    }

    renderSummary();
    if (accepted.length) runQueue();
  }

  // Prints colados chegam como "image.png": dá um nome que não se repete.
  function renamePasted(files) {
    const stamp = Date.now();
    return Array.from(files).map((file, i) => {
      if (file.name && !/^image\.[a-z0-9]+$/i.test(file.name)) return file;
      const sub = (file.type.split("/")[1] || "png").toLowerCase();
      const ext = sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub;
      return new File([file], `colada-${stamp}-${i + 1}.${ext}`, {
        type: file.type,
        lastModified: file.lastModified,
      });
    });
  }

  function hasFiles(e) {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  }

  let dragDepth = 0;

  function bindInput() {
    el.file.addEventListener("change", () => {
      addFiles(el.file.files);
      el.file.value = ""; // aceita o mesmo arquivo de novo
    });

    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      el.drop.classList.add("is-over");
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) el.drop.classList.remove("is-over");
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // não deixa o navegador abrir a imagem no lugar da página
      dragDepth = 0;
      el.drop.classList.remove("is-over");
      addFiles(e.dataTransfer.files);
    });

    window.addEventListener("paste", (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (!files || !files.length) return;
      e.preventDefault();
      addFiles(renamePasted(files));
    });
  }

  /* ---------- Renderização ---------- */

  function buildItem(item) {
    const name = item.file.name;

    const li = document.createElement("li");
    li.className = "file";

    const thumbBox = document.createElement("span");
    thumbBox.className = "file__thumb";
    const thumb = document.createElement("img");
    thumb.alt = "";
    thumb.width = 56;
    thumb.height = 56;
    thumb.hidden = true;
    thumbBox.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "file__info";

    const title = document.createElement("p");
    title.className = "file__name";
    title.textContent = name;
    title.title = name;

    const meta = document.createElement("p");
    meta.className = "file__meta";
    const before = document.createElement("span");
    const after = document.createElement("span");
    const delta = document.createElement("span");
    delta.className = "file__delta";
    meta.append(before, after, delta);

    const status = document.createElement("p");
    status.className = "file__status";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    const statusText = document.createElement("span");
    status.append(spinner, statusText);

    info.append(title, meta, status);

    const actions = document.createElement("div");
    actions.className = "file__acoes";

    const download = document.createElement("button");
    download.type = "button";
    download.className = "icone-botao";
    download.setAttribute("aria-label", `Baixar ${name} convertido`);
    download.title = "Baixar";
    download.appendChild(icon(ICONS.download));
    download.addEventListener("click", () => {
      if (item.out) downloadUrl(item.out.url, item.out.name);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icone-botao icone-botao--remover";
    remove.setAttribute("aria-label", `Remover ${name}`);
    remove.title = "Remover";
    remove.appendChild(icon(ICONS.remove));
    remove.addEventListener("click", () => removeItem(item));

    actions.append(download, remove);
    li.append(thumbBox, info, actions);

    item.li = li;
    item.refs = { thumb, before, after, delta, status, spinner, statusText, download, remove };
  }

  function renderItem(item) {
    const { refs, file, decoded, out } = item;
    if (!refs) return;

    if (item.thumbUrl && refs.thumb.hidden) {
      refs.thumb.src = item.thumbUrl;
      refs.thumb.hidden = false;
    }

    refs.before.textContent = formatBytes(file.size) + (decoded ? ` · ${decoded.w}×${decoded.h}` : "");

    if (out) {
      refs.after.textContent = ` → ${formatBytes(out.blob.size)} · ${out.w}×${out.h} · ${extOf(out.name)}`;
      const d = formatDelta(file.size, out.blob.size);
      refs.delta.textContent = d.text;
      refs.delta.className = `file__delta ${d.cls}`.trim();
      refs.delta.title = d.title;
    } else {
      refs.after.textContent = "";
      refs.delta.textContent = "";
      refs.delta.title = "";
    }

    const busy = item.status === "queued" || item.status === "working";
    const failed = item.status === "error";
    refs.status.hidden = !(busy || failed);
    refs.status.classList.toggle("is-error", failed);
    refs.spinner.hidden = !busy;
    if (item.status === "queued") refs.statusText.textContent = "Na fila…";
    else if (busy) refs.statusText.textContent = item.statusText || "Convertendo…";
    else refs.statusText.textContent = failed ? item.statusText : "";

    refs.download.disabled = item.status !== "done";
  }

  function extOf(name) {
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot) : "";
  }

  function renderSummary() {
    const total = state.items.length;
    const done = state.items.filter((i) => i.status === "done" && i.out);
    const busy = state.running || state.items.some((i) => i.status === "queued" || i.status === "working");

    el.summary.hidden = total === 0;
    el.empty.hidden = total > 0;

    const before = done.reduce((sum, i) => sum + i.file.size, 0);
    const after = done.reduce((sum, i) => sum + i.out.blob.size, 0);

    el.sumCount.textContent = `${done.length}/${total}`;
    el.sumBefore.textContent = done.length ? formatBytes(before) : "–";
    el.sumAfter.textContent = done.length ? formatBytes(after) : "–";

    if (before > 0) {
      const d = formatDelta(before, after);
      el.sumSaving.textContent = d.text;
      el.sumSaving.className = d.cls;
    } else {
      el.sumSaving.textContent = "–";
      el.sumSaving.className = "";
    }

    el.zip.disabled = done.length === 0 || busy || state.zipping;
    if (state.zipping) el.zip.textContent = "Gerando ZIP…";
    else if (busy) el.zip.textContent = "Convertendo…";
    else el.zip.textContent = "Baixar tudo (.zip)";
  }

  /* ---------- Remover e limpar ---------- */

  function releaseItem(item) {
    item.removed = true;
    if (item.out && item.out.url) URL.revokeObjectURL(item.out.url);
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    releaseDecoded(item.decoded);
    item.out = null;
    item.decoded = null;
    item.thumbUrl = "";
    if (item.li) item.li.remove();
  }

  function removeItem(item) {
    const index = state.items.indexOf(item);
    if (index < 0) return;
    releaseItem(item);
    state.items.splice(index, 1);
    renderSummary();

    // Mantém o foco num lugar útil para quem navega pelo teclado.
    const next = state.items[index] || state.items[index - 1];
    if (next) next.refs.remove.focus();
    else el.file.focus();
  }

  function clearAll() {
    for (const item of state.items) releaseItem(item);
    state.items = [];
    renderSummary();
    el.file.focus();
  }

  /* ---------- ZIP ---------- */

  // foto.jpg, foto-2.jpg, foto-3.jpg...
  function uniqueName(name, used) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${base}-${n++}${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  }

  async function downloadZip() {
    if (typeof window.JSZip !== "function") {
      toast("Não foi possível carregar o gerador de ZIP. Recarregue a página.");
      return;
    }
    const done = state.items.filter((i) => i.status === "done" && i.out);
    if (!done.length) return;

    state.zipping = true;
    renderSummary();
    try {
      const zip = new window.JSZip();
      const used = new Set();
      for (const item of done) zip.file(uniqueName(item.out.name, used), item.out.blob);
      // Imagens já são comprimidas: comprimir de novo só deixa mais lento.
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const url = URL.createObjectURL(blob);
      downloadUrl(url, "imagens-convertidas.zip");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(done.length === 1 ? "1 imagem baixada em ZIP." : `${done.length} imagens baixadas em ZIP.`);
    } catch (_) {
      toast("Não foi possível gerar o ZIP. Tente baixar as imagens uma a uma.");
    } finally {
      state.zipping = false;
      renderSummary();
    }
  }

  /* ---------- Início ---------- */

  function bindPanel() {
    for (const radio of document.querySelectorAll('input[name="fmt"], input[name="resize"]')) {
      radio.addEventListener("change", onConfigChange);
    }
    for (const input of [el.quality, el.maxWidth, el.percent, el.bg]) {
      input.addEventListener("input", onConfigChange);
    }
    // Ao sair do campo, mostra o valor que de fato está valendo.
    el.maxWidth.addEventListener("change", () => { el.maxWidth.value = readConfig().maxWidth; });
    el.percent.addEventListener("change", () => { el.percent.value = readConfig().percent; });

    el.clear.addEventListener("click", clearAll);
    el.zip.addEventListener("click", downloadZip);
  }

  function init() {
    state.webpOk = detectWebp();
    if (!state.webpOk) {
      const webp = document.querySelector('input[name="fmt"][value="image/webp"]');
      webp.disabled = true;
      webp.checked = false;
      document.querySelector('input[name="fmt"][value="image/jpeg"]').checked = true;
    }
    loadConfig();
    syncPanel();
    bindPanel();
    bindInput();
    renderSummary();
  }

  init();
})();
