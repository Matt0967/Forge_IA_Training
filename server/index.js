const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { execFile, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const PORT = Number(process.env.PORT || 5173);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const SAFE_TERMINAL_HEADER = "x-forge-terminal";
const SAFE_PULL_MODELS = new Set([
  "llama3.2:3b",
  "nomic-embed-text",
  "qwen2.5:7b",
  "mistral:7b",
  "gemma3:4b",
  "mxbai-embed-large"
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function defaultStore() {
  const assistantId = id("asst");
  return {
    version: 1,
    settings: {
      chatModel: "llama3.2:3b",
      embeddingModel: "nomic-embed-text",
      temperature: 0.35,
      retrievalLimit: 6,
      strictDocuments: false
    },
    activeAssistantId: assistantId,
    assistants: [
      {
        id: assistantId,
        name: "Nova Local",
        role: "Assistant personnel local qui repond avec clarte et utilise les documents quand ils sont utiles.",
        style: "Direct, pedagogique, concret, avec des reponses courtes par defaut.",
        audience: "Debutant en IA qui veut apprendre vite sans payer d'infrastructure.",
        createdAt: now(),
        updatedAt: now(),
        memories: [
          {
            id: id("mem"),
            text: "L'utilisateur prefere des explications simples, actionnables et sans jargon inutile.",
            createdAt: now()
          }
        ],
        messages: []
      }
    ],
    documents: []
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const store = defaultStore();
      saveStore(store);
      return store;
    }
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch (error) {
    console.error("Could not read store.json, creating a clean store:", error.message);
    const store = defaultStore();
    saveStore(store);
    return store;
  }
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function sanitizeStore(store) {
  return {
    ...store,
    documents: store.documents.map((doc) => ({
      id: doc.id,
      assistantId: doc.assistantId,
      name: doc.name,
      type: doc.type,
      size: doc.size,
      textLength: doc.textLength,
      chunkCount: doc.chunks.length,
      indexStatus: doc.indexStatus,
      extractionStatus: doc.extractionStatus,
      error: doc.error || null,
      createdAt: doc.createdAt
    }))
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function runExecFile(file, args, timeout = 120000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    execFile(
      file,
      args,
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stdout: stdout || "",
          stderr: stderr || (error && error.killed ? "Commande arretee: delai depasse." : ""),
          durationMs: Date.now() - startedAt
        });
      }
    );
  });
}

function normalizeCommand(command) {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function blockedTerminalResult(command, reason) {
  return {
    ok: false,
    blocked: true,
    command,
    stdout: "",
    stderr: reason,
    code: 126,
    durationMs: 0
  };
}

function safeTerminalHelp() {
  return [
    "Commandes autorisees:",
    "  help",
    "  clear",
    "  pwd",
    "  date",
    "  node --version",
    "  npm --version",
    "  ollama health",
    "  ollama --version",
    "  ollama list",
    "  ollama ps",
    "  ollama pull llama3.2:3b",
    "  ollama pull nomic-embed-text",
    "  ollama pull qwen2.5:7b",
    "  ollama pull mistral:7b",
    "  ollama pull gemma3:4b",
    "",
    "Les commandes shell libres, pipes, redirections, sudo et suppressions sont bloquees."
  ].join("\n");
}

async function runSafeTerminalCommand(command) {
  const normalized = normalizeCommand(command);
  if (!normalized) return blockedTerminalResult(normalized, "Commande vide.");
  if (normalized.length > 140) return blockedTerminalResult(normalized, "Commande trop longue.");
  if (/[;&|<>`$\\\n\r]/.test(normalized)) {
    return blockedTerminalResult(normalized, "Commande bloquee: operateurs shell interdits.");
  }

  if (normalized === "clear") {
    return { ok: true, command: normalized, stdout: "__CLEAR__", stderr: "", code: 0, durationMs: 0 };
  }

  if (normalized === "help") {
    return { ok: true, command: normalized, stdout: safeTerminalHelp(), stderr: "", code: 0, durationMs: 0 };
  }

  if (normalized === "ollama health") {
    const health = await ollamaHealth();
    return {
      ok: health.ok,
      command: normalized,
      stdout: health.ok
        ? `Ollama OK sur ${health.url}\nModeles detectes: ${health.models.map((model) => model.name).join(", ") || "aucun"}`
        : `Ollama indisponible sur ${health.url}`,
      stderr: health.ok ? "" : health.error || "fetch failed",
      code: health.ok ? 0 : 1,
      durationMs: 0
    };
  }

  if (normalized === "pwd") {
    return { ok: true, command: normalized, stdout: `${ROOT}\n`, stderr: "", code: 0, durationMs: 0 };
  }

  if (normalized === "date") {
    return { ok: true, command: normalized, stdout: `${new Date().toString()}\n`, stderr: "", code: 0, durationMs: 0 };
  }

  const exactCommands = new Map([
    ["node --version", ["node", ["--version"], 15000]],
    ["npm --version", ["npm", ["--version"], 15000]],
    ["ollama --version", ["ollama", ["--version"], 15000]],
    ["ollama list", ["ollama", ["list"], 20000]],
    ["ollama ps", ["ollama", ["ps"], 20000]]
  ]);

  if (exactCommands.has(normalized)) {
    const [file, args, timeout] = exactCommands.get(normalized);
    const result = await runExecFile(file, args, timeout);
    return { command: normalized, ...result };
  }

  const pullMatch = /^ollama pull ([a-z0-9._:-]+)$/.exec(normalized);
  if (pullMatch) {
    const model = pullMatch[1];
    if (!SAFE_PULL_MODELS.has(model)) {
      return blockedTerminalResult(normalized, `Modele non autorise dans ce prototype: ${model}`);
    }
    const result = await runExecFile("ollama", ["pull", model], 10 * 60 * 1000);
    return { command: normalized, ...result };
  }

  return blockedTerminalResult(normalized, "Commande non autorisee. Tape `help` pour voir la liste safe.");
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

async function requestOllama(endpoint, payload) {
  const response = await fetch(`${OLLAMA_URL}${endpoint}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const detail = json.error || json.raw || response.statusText;
    throw new Error(detail);
  }
  return json;
}

async function ollamaHealth() {
  try {
    const tags = await requestOllama("/api/tags");
    return {
      ok: true,
      url: OLLAMA_URL,
      models: Array.isArray(tags.models)
        ? tags.models.map((model) => ({
            name: model.name,
            size: model.size,
            modifiedAt: model.modified_at
          }))
        : []
    };
  } catch (error) {
    return {
      ok: false,
      url: OLLAMA_URL,
      models: [],
      error: error.message
    };
  }
}

function contentDispositionValue(header, key) {
  const match = new RegExp(`${key}="([^"]*)"`).exec(header);
  return match ? match[1] : "";
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Missing multipart boundary");
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const raw = buffer.toString("latin1");
  const sections = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (const section of sections) {
    const part = section.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerBlock = part.slice(0, headerEnd);
    let body = part.slice(headerEnd + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);

    const headers = Object.fromEntries(
      headerBlock.split(/\r?\n/).map((line) => {
        const index = line.indexOf(":");
        return index === -1
          ? [line.toLowerCase(), ""]
          : [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
      })
    );

    const disposition = headers["content-disposition"] || "";
    const name = contentDispositionValue(disposition, "name");
    const filename = contentDispositionValue(disposition, "filename");
    const data = Buffer.from(body, "latin1");

    if (filename) {
      files.push({
        field: name,
        filename,
        type: headers["content-type"] || "application/octet-stream",
        data
      });
    } else if (name) {
      fields[name] = data.toString("utf8");
    }
  }

  return { fields, files };
}

function safeFilename(filename) {
  const clean = path.basename(filename).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return clean || "document.txt";
}

function normalizeText(text) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodePdfString(input) {
  return input.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, escaped) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    if (escaped === "b") return "\b";
    if (escaped === "f") return "\f";
    if (escaped === "(") return "(";
    if (escaped === ")") return ")";
    if (escaped === "\\") return "\\";
    if (/^[0-7]+$/.test(escaped)) return String.fromCharCode(parseInt(escaped, 8));
    return escaped;
  });
}

function extractPdfTextFromContent(content) {
  const pieces = [];
  const stringPattern = /\((?:\\.|[^\\)])*\)/g;
  const hexPattern = /<([0-9A-Fa-f\s]{4,})>/g;
  let match;

  while ((match = stringPattern.exec(content))) {
    pieces.push(decodePdfString(match[0].slice(1, -1)));
  }

  while ((match = hexPattern.exec(content))) {
    const hex = match[1].replace(/\s+/g, "");
    if (hex.length % 2 !== 0) continue;
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      const value = parseInt(hex.slice(i, i + 2), 16);
      if (Number.isFinite(value) && value >= 32 && value <= 126) bytes.push(value);
    }
    if (bytes.length > 2) pieces.push(Buffer.from(bytes).toString("utf8"));
  }

  return pieces.join(" ");
}

function extractPdfText(buffer) {
  const raw = buffer.toString("latin1");
  const outputs = [extractPdfTextFromContent(raw)];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamPattern.exec(raw))) {
    const stream = Buffer.from(match[1], "latin1");
    for (const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        const content = inflate(stream).toString("latin1");
        outputs.push(extractPdfTextFromContent(content));
        break;
      } catch {
        // Try the next inflate mode.
      }
    }
  }

  return normalizeText(outputs.join("\n"));
}

function extractWithTextutil(filePath) {
  return execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", filePath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 12000
  });
}

function extractText(filePath, originalName, mimeType, buffer) {
  const ext = path.extname(originalName).toLowerCase();
  const textExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log"]);

  try {
    if (textExtensions.has(ext) || mimeType.startsWith("text/")) {
      return {
        text: normalizeText(buffer.toString("utf8")),
        status: "ok"
      };
    }

    if ([".docx", ".doc", ".rtf", ".html", ".htm"].includes(ext)) {
      return {
        text: normalizeText(extractWithTextutil(filePath)),
        status: "ok"
      };
    }

    if (ext === ".pdf" || mimeType === "application/pdf") {
      const text = extractPdfText(buffer);
      return {
        text,
        status: text.length > 120 ? "ok" : "partial"
      };
    }

    return {
      text: normalizeText(buffer.toString("utf8")),
      status: "partial"
    };
  } catch (error) {
    return {
      text: "",
      status: "failed",
      error: error.message
    };
  }
}

function chunkText(text) {
  const clean = normalizeText(text);
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  const target = 1500;
  const overlap = 240;

  function pushCurrent() {
    const text = current.trim();
    if (!text) return;
    chunks.push({
      id: id("chunk"),
      text,
      embedding: null
    });
    current = text.slice(Math.max(0, text.length - overlap));
  }

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > target) {
      pushCurrent();
    }
    current = `${current}\n\n${paragraph}`.trim();
  }
  pushCurrent();
  return chunks;
}

async function embedTexts(texts, model) {
  if (!texts.length) return [];

  try {
    const response = await requestOllama("/api/embed", {
      model,
      input: texts
    });
    if (Array.isArray(response.embeddings)) return response.embeddings;
    if (Array.isArray(response.embedding)) return [response.embedding];
  } catch (error) {
    // Older Ollama versions use /api/embeddings. Fall through to the legacy path.
  }

  const embeddings = [];
  for (const text of texts) {
    const response = await requestOllama("/api/embeddings", {
      model,
      prompt: text
    });
    if (!Array.isArray(response.embedding)) throw new Error("Ollama did not return an embedding");
    embeddings.push(response.embedding);
  }
  return embeddings;
}

async function attachEmbeddings(chunks, model) {
  if (!chunks.length) {
    return { status: "empty", error: null };
  }

  try {
    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text), model);
    embeddings.forEach((embedding, index) => {
      chunks[index].embedding = embedding;
    });
    return { status: "vector", error: null };
  } catch (error) {
    return { status: "keyword", error: error.message };
  }
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function keywordScore(query, text) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const textTokens = tokenize(text);
  if (!textTokens.length) return 0;
  const counts = new Map();
  for (const token of textTokens) counts.set(token, (counts.get(token) || 0) + 1);
  const uniqueQuery = [...new Set(queryTokens)];
  let score = 0;
  for (const token of uniqueQuery) {
    score += Math.min(4, counts.get(token) || 0);
  }
  const normalizedText = textTokens.join(" ");
  const phrase = queryTokens.slice(0, 5).join(" ");
  if (phrase.length > 8 && normalizedText.includes(phrase)) score += 5;
  return score / Math.sqrt(textTokens.length);
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function retrieve(store, assistantId, query) {
  const docs = store.documents.filter((doc) => doc.assistantId === assistantId);
  const chunks = docs.flatMap((doc) =>
    doc.chunks.map((chunk) => ({
      ...chunk,
      documentId: doc.id,
      documentName: doc.name,
      documentType: doc.type
    }))
  );

  let queryEmbedding = null;
  const hasVectors = chunks.some((chunk) => Array.isArray(chunk.embedding));
  if (hasVectors) {
    try {
      const embeddings = await embedTexts([query], store.settings.embeddingModel);
      queryEmbedding = embeddings[0];
    } catch {
      queryEmbedding = null;
    }
  }

  return chunks
    .map((chunk) => {
      const lexical = keywordScore(query, chunk.text);
      const semantic = queryEmbedding && chunk.embedding ? cosine(queryEmbedding, chunk.embedding) : 0;
      const score = queryEmbedding ? semantic * 0.75 + lexical * 0.25 : lexical;
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, store.settings.retrievalLimit || 6);
}

function buildPrompt(assistant, store, hits, strictDocuments) {
  const memories = assistant.memories.map((memory) => `- ${memory.text}`).join("\n") || "- Aucune memoire.";
  const context = hits
    .map((hit, index) => {
      return `SOURCE ${index + 1}: ${hit.documentName}\n${hit.text}`;
    })
    .join("\n\n---\n\n");

  return [
    `Tu es ${assistant.name}.`,
    `Role: ${assistant.role}`,
    `Style: ${assistant.style}`,
    `Audience: ${assistant.audience || "Utilisateur non precise."}`,
    "Tu reponds en francais, avec des phrases claires et utiles.",
    "Quand tu utilises un document, cite le nom du document dans la reponse.",
    "Ne fais pas semblant d'avoir lu une source si elle n'est pas dans le contexte.",
    strictDocuments
      ? "Mode strict: si la reponse n'est pas dans les documents, dis clairement que les documents ne suffisent pas."
      : "Tu peux utiliser ton raisonnement general, mais separe clairement ce qui vient des documents et ce qui est une suggestion.",
    "",
    "Memoires utilisateur:",
    memories,
    "",
    "Contexte documentaire disponible:",
    context || "Aucun passage pertinent n'a ete trouve."
  ].join("\n");
}

function recentMessages(assistant) {
  return assistant.messages
    .slice(-10)
    .map((message) => ({ role: message.role, content: message.content }));
}

function fallbackAnswer(message, hits, health) {
  if (!health.ok) {
    const sources = hits.slice(0, 3).map((hit) => `- ${hit.documentName}: ${hit.text.slice(0, 260)}...`).join("\n");
    return [
      "Ollama n'est pas encore disponible, donc je ne peux pas generer une vraie reponse LLM locale pour l'instant.",
      "",
      hits.length
        ? `J'ai quand meme retrouve des passages utiles dans tes documents:\n${sources}`
        : "Aucun passage pertinent n'a ete trouve dans les documents indexes.",
      "",
      "Pour activer le chat local: installe Ollama, lance `ollama serve`, puis telecharge un modele comme `ollama pull llama3.2:3b` et l'embedding `ollama pull nomic-embed-text`."
    ].join("\n");
  }

  return [
    "Le modele configure n'a pas repondu correctement.",
    "Verifie que le modele est telecharge dans Ollama ou change le modele dans les reglages.",
    "",
    `Question recue: ${message}`
  ].join("\n");
}

async function handleUpload(req, res, store) {
  const body = await readBody(req, MAX_UPLOAD_BYTES);
  const { fields, files } = parseMultipart(body, req.headers["content-type"]);
  const assistantId = fields.assistantId || store.activeAssistantId;
  const assistant = store.assistants.find((item) => item.id === assistantId);
  if (!assistant) return sendJson(res, 404, { error: "Assistant introuvable" });
  if (!files.length) return sendJson(res, 400, { error: "Aucun fichier envoye" });

  const created = [];
  for (const file of files) {
    const original = safeFilename(file.filename);
    const fileId = id("doc");
    const storedName = `${fileId}_${original}`;
    const filePath = path.join(UPLOAD_DIR, storedName);
    fs.writeFileSync(filePath, file.data);

    const extraction = extractText(filePath, original, file.type, file.data);
    const chunks = chunkText(extraction.text);
    const embedding = await attachEmbeddings(chunks, store.settings.embeddingModel);
    const document = {
      id: fileId,
      assistantId,
      name: original,
      storedName,
      type: file.type,
      size: file.data.length,
      textLength: extraction.text.length,
      extractionStatus: extraction.status,
      indexStatus: embedding.status,
      error: extraction.error || embedding.error || null,
      chunks,
      createdAt: now()
    };
    store.documents.push(document);
    created.push(document);
  }

  assistant.updatedAt = now();
  saveStore(store);
  return sendJson(res, 201, {
    documents: created.map((doc) => ({
      id: doc.id,
      name: doc.name,
      chunkCount: doc.chunks.length,
      indexStatus: doc.indexStatus,
      extractionStatus: doc.extractionStatus,
      error: doc.error
    })),
    state: sanitizeStore(store)
  });
}

async function handleChat(req, res, store) {
  const payload = await readJson(req);
  const assistantId = payload.assistantId || store.activeAssistantId;
  const assistant = store.assistants.find((item) => item.id === assistantId);
  const message = String(payload.message || "").trim();
  if (!assistant) return sendJson(res, 404, { error: "Assistant introuvable" });
  if (!message) return sendJson(res, 400, { error: "Message vide" });

  const strictDocuments = Boolean(payload.strictDocuments ?? store.settings.strictDocuments);
  const hits = await retrieve(store, assistant.id, message);
  const health = await ollamaHealth();

  const userMessage = {
    id: id("msg"),
    role: "user",
    content: message,
    createdAt: now()
  };
  assistant.messages.push(userMessage);

  let answer;
  let usedModel = store.settings.chatModel;
  try {
    if (!health.ok) throw new Error(health.error || "Ollama unavailable");
    const prompt = buildPrompt(assistant, store, hits, strictDocuments);
    const response = await requestOllama("/api/chat", {
      model: store.settings.chatModel,
      stream: false,
      options: {
        temperature: Number(store.settings.temperature ?? 0.35)
      },
      messages: [
        { role: "system", content: prompt },
        ...recentMessages(assistant).slice(0, -1),
        { role: "user", content: message }
      ]
    });
    answer = response.message?.content || response.response || "";
    if (!answer.trim()) throw new Error("Empty model response");
  } catch (error) {
    answer = fallbackAnswer(message, hits, health);
    usedModel = health.ok ? `${store.settings.chatModel} (erreur: ${error.message})` : "fallback-local";
  }

  const assistantMessage = {
    id: id("msg"),
    role: "assistant",
    content: answer,
    model: usedModel,
    sources: hits.map((hit) => ({
      documentId: hit.documentId,
      documentName: hit.documentName,
      score: Number(hit.score.toFixed(4)),
      preview: hit.text.slice(0, 320)
    })),
    createdAt: now()
  };

  assistant.messages.push(assistantMessage);
  assistant.updatedAt = now();
  saveStore(store);
  return sendJson(res, 200, {
    message: assistantMessage,
    state: sanitizeStore(store)
  });
}

async function handleCreateAssistant(req, res, store) {
  const payload = await readJson(req);
  const assistant = {
    id: id("asst"),
    name: String(payload.name || "Nouvelle IA").trim().slice(0, 80),
    role: String(payload.role || "Assistant personnel local.").trim(),
    style: String(payload.style || "Clair, direct et utile.").trim(),
    audience: String(payload.audience || "Utilisateur debutant.").trim(),
    createdAt: now(),
    updatedAt: now(),
    memories: [],
    messages: []
  };
  store.assistants.push(assistant);
  store.activeAssistantId = assistant.id;
  saveStore(store);
  return sendJson(res, 201, { assistant, state: sanitizeStore(store) });
}

async function handleUpdateAssistant(req, res, store, assistantId) {
  const payload = await readJson(req);
  const assistant = store.assistants.find((item) => item.id === assistantId);
  if (!assistant) return sendJson(res, 404, { error: "Assistant introuvable" });
  for (const key of ["name", "role", "style", "audience"]) {
    if (payload[key] !== undefined) assistant[key] = String(payload[key]).trim();
  }
  assistant.updatedAt = now();
  saveStore(store);
  return sendJson(res, 200, { assistant, state: sanitizeStore(store) });
}

async function handleMemory(req, res, store, assistantId) {
  const payload = await readJson(req);
  const assistant = store.assistants.find((item) => item.id === assistantId);
  const text = String(payload.text || "").trim();
  if (!assistant) return sendJson(res, 404, { error: "Assistant introuvable" });
  if (!text) return sendJson(res, 400, { error: "Memoire vide" });
  assistant.memories.push({ id: id("mem"), text, createdAt: now() });
  assistant.updatedAt = now();
  saveStore(store);
  return sendJson(res, 201, { state: sanitizeStore(store) });
}

function deleteMemory(res, store, assistantId, memoryId) {
  const assistant = store.assistants.find((item) => item.id === assistantId);
  if (!assistant) return sendJson(res, 404, { error: "Assistant introuvable" });
  assistant.memories = assistant.memories.filter((memory) => memory.id !== memoryId);
  assistant.updatedAt = now();
  saveStore(store);
  return sendJson(res, 200, { state: sanitizeStore(store) });
}

function deleteDocument(res, store, documentId) {
  const document = store.documents.find((item) => item.id === documentId);
  store.documents = store.documents.filter((item) => item.id !== documentId);
  if (document) {
    const filePath = path.join(UPLOAD_DIR, document.storedName);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Deleting the db entry matters more than a stale file in this prototype.
    }
  }
  saveStore(store);
  return sendJson(res, 200, { state: sanitizeStore(store) });
}

async function handleSettings(req, res, store) {
  const payload = await readJson(req);
  const next = { ...store.settings };
  if (payload.chatModel !== undefined) next.chatModel = String(payload.chatModel).trim();
  if (payload.embeddingModel !== undefined) next.embeddingModel = String(payload.embeddingModel).trim();
  if (payload.temperature !== undefined) next.temperature = Number(payload.temperature);
  if (payload.retrievalLimit !== undefined) next.retrievalLimit = Number(payload.retrievalLimit);
  if (payload.strictDocuments !== undefined) next.strictDocuments = Boolean(payload.strictDocuments);
  store.settings = next;
  saveStore(store);
  return sendJson(res, 200, { state: sanitizeStore(store) });
}

async function handleTerminal(req, res) {
  if (req.headers[SAFE_TERMINAL_HEADER] !== "1") {
    return sendJson(res, 403, { error: "Terminal refuse: header de securite manquant." });
  }
  const payload = await readJson(req);
  const command = normalizeCommand(payload.command || "");
  const result = await runSafeTerminalCommand(command);
  return sendJson(res, result.blocked ? 400 : 200, {
    ...result,
    command,
    cwd: ROOT,
    finishedAt: now()
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");

  fs.readFile(filePath, (error, content) => {
    if (error) return sendText(res, 404, "Not found");
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    sendText(res, 200, content, types[ext] || "application/octet-stream");
  });
}

async function route(req, res) {
  const store = loadStore();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (req.method === "GET" && pathname === "/api/state") {
      return sendJson(res, 200, sanitizeStore(store));
    }

    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 200, await ollamaHealth());
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      return await handleUpload(req, res, store);
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      return await handleChat(req, res, store);
    }

    if (req.method === "POST" && pathname === "/api/assistants") {
      return await handleCreateAssistant(req, res, store);
    }

    const assistantMatch = /^\/api\/assistants\/([^/]+)$/.exec(pathname);
    if (req.method === "PATCH" && assistantMatch) {
      return await handleUpdateAssistant(req, res, store, assistantMatch[1]);
    }

    const memoryMatch = /^\/api\/assistants\/([^/]+)\/memories$/.exec(pathname);
    if (req.method === "POST" && memoryMatch) {
      return await handleMemory(req, res, store, memoryMatch[1]);
    }

    const deleteMemoryMatch = /^\/api\/assistants\/([^/]+)\/memories\/([^/]+)$/.exec(pathname);
    if (req.method === "DELETE" && deleteMemoryMatch) {
      return deleteMemory(res, store, deleteMemoryMatch[1], deleteMemoryMatch[2]);
    }

    const deleteDocumentMatch = /^\/api\/documents\/([^/]+)$/.exec(pathname);
    if (req.method === "DELETE" && deleteDocumentMatch) {
      return deleteDocument(res, store, deleteDocumentMatch[1]);
    }

    if (req.method === "POST" && pathname === "/api/settings") {
      return await handleSettings(req, res, store);
    }

    if (req.method === "POST" && pathname === "/api/terminal") {
      return await handleTerminal(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(req, res);
    }

    return sendJson(res, 404, { error: "Route introuvable" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || "Erreur serveur" });
  }
}

const server = http.createServer(route);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local Personal AI Dashboard`);
  console.log(`URL: http://127.0.0.1:${PORT}`);
  console.log(`Ollama: ${OLLAMA_URL}`);
});
