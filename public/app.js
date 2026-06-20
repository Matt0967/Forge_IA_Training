const state = {
  data: null,
  health: null,
  activeAssistantId: null,
  sending: false,
  terminalRunning: false,
  terminalEntries: [
    {
      type: "system",
      text: "Terminal safe pret. Tape `help` pour voir les commandes autorisees."
    }
  ],
  terminalHistory: [],
  terminalHistoryIndex: -1
};

const els = {
  assistantList: document.getElementById("assistantList"),
  createAssistantButton: document.getElementById("createAssistantButton"),
  assistantTitle: document.getElementById("assistantTitle"),
  modelPill: document.getElementById("modelPill"),
  strictToggle: document.getElementById("strictToggle"),
  messageList: document.getElementById("messageList"),
  chatForm: document.getElementById("chatForm"),
  messageInput: document.getElementById("messageInput"),
  sendButton: document.getElementById("sendButton"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  pickFilesButton: document.getElementById("pickFilesButton"),
  uploadStatus: document.getElementById("uploadStatus"),
  documentList: document.getElementById("documentList"),
  documentCount: document.getElementById("documentCount"),
  assistantName: document.getElementById("assistantName"),
  assistantRole: document.getElementById("assistantRole"),
  assistantStyle: document.getElementById("assistantStyle"),
  assistantAudience: document.getElementById("assistantAudience"),
  saveAssistantButton: document.getElementById("saveAssistantButton"),
  memoryForm: document.getElementById("memoryForm"),
  memoryInput: document.getElementById("memoryInput"),
  memoryList: document.getElementById("memoryList"),
  memoryCount: document.getElementById("memoryCount"),
  chatModel: document.getElementById("chatModel"),
  embeddingModel: document.getElementById("embeddingModel"),
  temperature: document.getElementById("temperature"),
  retrievalLimit: document.getElementById("retrievalLimit"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  healthCard: document.getElementById("healthCard"),
  healthText: document.getElementById("healthText"),
  setupBox: document.getElementById("setupBox"),
  terminalOutput: document.getElementById("terminalOutput"),
  terminalForm: document.getElementById("terminalForm"),
  terminalInput: document.getElementById("terminalInput"),
  runTerminalButton: document.getElementById("runTerminalButton"),
  clearTerminalButton: document.getElementById("clearTerminalButton")
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Erreur reseau");
  return json;
}

function activeAssistant() {
  if (!state.data) return null;
  return state.data.assistants.find((assistant) => assistant.id === state.activeAssistantId)
    || state.data.assistants[0]
    || null;
}

function activeDocuments() {
  if (!state.data) return [];
  return state.data.documents.filter((doc) => doc.assistantId === state.activeAssistantId);
}

async function loadState() {
  state.data = await api("/api/state");
  state.activeAssistantId = state.activeAssistantId || state.data.activeAssistantId;
  render();
}

async function loadHealth() {
  state.health = await api("/api/health");
  renderHealth();
}

function render() {
  if (!state.data) return;
  renderAssistants();
  renderTopbar();
  renderMessages();
  renderDocuments();
  renderAssistantForm();
  renderMemory();
  renderSettings();
  renderTerminal();
  renderHealth();
}

function renderAssistants() {
  els.assistantList.innerHTML = state.data.assistants.map((assistant) => {
    const count = state.data.documents.filter((doc) => doc.assistantId === assistant.id).length;
    return `
      <button class="assistant-item ${assistant.id === state.activeAssistantId ? "active" : ""}" data-assistant-id="${assistant.id}" type="button">
        <strong>${escapeHtml(assistant.name)}</strong>
        <span>${count} document${count > 1 ? "s" : ""}</span>
      </button>
    `;
  }).join("");
}

function renderTopbar() {
  const assistant = activeAssistant();
  if (!assistant) return;
  els.assistantTitle.textContent = assistant.name;
  els.modelPill.textContent = state.data.settings.chatModel || "Modele local";
  els.strictToggle.checked = Boolean(state.data.settings.strictDocuments);
}

function renderMessages() {
  const assistant = activeAssistant();
  if (!assistant) return;

  if (!assistant.messages.length) {
    els.messageList.innerHTML = `
      <div class="empty-state">
        <div class="die-stage" aria-hidden="true">
          <div class="neural-die">
            <span class="die-face face-front"></span>
            <span class="die-face face-back"></span>
            <span class="die-face face-right"></span>
            <span class="die-face face-left"></span>
            <span class="die-face face-top"></span>
            <span class="die-face face-bottom"></span>
          </div>
        </div>
        <div class="empty-copy">
          <span class="terminal-kicker">~/forge/start</span>
          <h2>Ton assistant est pret.</h2>
          <p>Drop tes docs, choisis sa vibe, puis lance une question. Si Ollama dort encore, Forge te montre deja les fragments utiles; quand il tourne, l'agent repond en local.</p>
        </div>
      </div>
    `;
    return;
  }

  els.messageList.innerHTML = assistant.messages.map((message) => {
    const sources = message.sources?.length
      ? `<div class="source-list">${message.sources.map((source) => `
          <div class="source-item">
            <strong>${escapeHtml(source.documentName)}</strong>
            <div>${escapeHtml(source.preview)}</div>
          </div>
        `).join("")}</div>`
      : "";

    return `
      <article class="message ${message.role}">
        <div class="message-bubble">${escapeHtml(message.content)}</div>
        <div class="message-meta">${message.role === "assistant" ? escapeHtml(message.model || "assistant") : "vous"}</div>
        ${sources}
      </article>
    `;
  }).join("");
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderDocuments() {
  const docs = activeDocuments();
  els.documentCount.textContent = String(docs.length);
  if (!docs.length) {
    els.documentList.innerHTML = "";
    return;
  }
  els.documentList.innerHTML = docs.map((doc) => {
    const status = doc.indexStatus === "vector" ? "index vectoriel" : "recherche mots-cles";
    const partial = doc.extractionStatus === "partial" ? "Extraction partielle" : status;
    return `
      <div class="document-item">
        <div>
          <strong>${escapeHtml(doc.name)}</strong>
          <span>${formatBytes(doc.size)} - ${doc.chunkCount} chunks - ${escapeHtml(partial)}</span>
        </div>
        <button class="danger-button" data-delete-doc="${doc.id}" type="button" aria-label="Supprimer ${escapeHtml(doc.name)}">x</button>
      </div>
    `;
  }).join("");
}

function renderAssistantForm() {
  const assistant = activeAssistant();
  if (!assistant || document.activeElement?.closest(".field-grid")) return;
  els.assistantName.value = assistant.name || "";
  els.assistantRole.value = assistant.role || "";
  els.assistantStyle.value = assistant.style || "";
  els.assistantAudience.value = assistant.audience || "";
}

function renderMemory() {
  const assistant = activeAssistant();
  if (!assistant) return;
  els.memoryCount.textContent = String(assistant.memories.length);
  els.memoryList.innerHTML = assistant.memories.map((memory) => `
    <div class="memory-item">
      <span>${escapeHtml(memory.text)}</span>
      <button class="danger-button" data-delete-memory="${memory.id}" type="button" aria-label="Supprimer la memoire">x</button>
    </div>
  `).join("");
}

function renderSettings() {
  if (!state.data || document.activeElement?.closest(".field-grid.two")) return;
  els.chatModel.value = state.data.settings.chatModel || "";
  els.embeddingModel.value = state.data.settings.embeddingModel || "";
  els.temperature.value = state.data.settings.temperature ?? 0.35;
  els.retrievalLimit.value = state.data.settings.retrievalLimit ?? 6;
}

function renderTerminal() {
  if (!els.terminalOutput) return;
  els.terminalOutput.innerHTML = state.terminalEntries.map((entry) => {
    const label = entry.type === "input" ? "$" : entry.type === "error" ? "!" : ">";
    return `
      <div class="terminal-line ${entry.type}">
        <span>${label}</span>
        <pre>${escapeHtml(entry.text)}</pre>
      </div>
    `;
  }).join("");
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

function appendTerminal(type, text) {
  state.terminalEntries.push({ type, text: String(text || "").trimEnd() });
  state.terminalEntries = state.terminalEntries.slice(-80);
  renderTerminal();
}

function renderHealth() {
  if (!state.health) return;
  els.healthCard.classList.toggle("ok", state.health.ok);
  els.healthCard.classList.toggle("bad", !state.health.ok);
  els.healthText.textContent = state.health.ok
    ? `${state.health.models.length} modele${state.health.models.length > 1 ? "s" : ""} detecte${state.health.models.length > 1 ? "s" : ""}`
    : "non detecte";

  const models = state.health.models?.length
    ? `<div>Modeles installes: ${state.health.models.map((model) => escapeHtml(model.name)).join(", ")}</div>`
    : "";

  els.setupBox.innerHTML = state.health.ok
    ? `${models}<div>Pour 16 Go RAM, commence avec <strong>llama3.2:3b</strong>. Essaie <strong>qwen2.5:7b</strong> si ton Mac reste fluide.</div>`
    : `
      <div>Ollama n'est pas lance. Ouvre l'app Ollama ou lance <strong>ollama serve</strong> dans un terminal externe, puis utilise le terminal safe pour telecharger les modeles:</div>
      <code>ollama pull llama3.2:3b</code>
      <code>ollama pull nomic-embed-text</code>
    `;
}

function applyPersona(persona) {
  const presets = {
    prof: {
      role: "Professeur particulier qui explique les documents simplement et transforme les notions en exemples.",
      style: "Pedagogique, patient, structure, avec des analogies simples.",
      audience: "Debutant qui veut apprendre sans jargon."
    },
    coach: {
      role: "Coach personnel qui aide a transformer les documents en actions et decisions.",
      style: "Motivant, direct, concret, avec prochaines etapes claires.",
      audience: "Personne qui veut avancer vite sur ses objectifs."
    },
    analyste: {
      role: "Analyste qui compare les sources, repere les risques et donne une synthese fiable.",
      style: "Precis, factuel, prudent, avec hypotheses explicites.",
      audience: "Utilisateur qui veut prendre de meilleures decisions."
    },
    createur: {
      role: "Partenaire creatif qui transforme les documents en idees, contenus et angles originaux.",
      style: "Creatif, energique, clair, avec plusieurs options concretes.",
      audience: "Createur, entrepreneur ou maker."
    }
  };
  const preset = presets[persona];
  if (!preset) return;
  els.assistantRole.value = preset.role;
  els.assistantStyle.value = preset.style;
  els.assistantAudience.value = preset.audience;
}

async function saveAssistant() {
  const assistant = activeAssistant();
  if (!assistant) return;
  const result = await api(`/api/assistants/${assistant.id}`, {
    method: "PATCH",
    body: {
      name: els.assistantName.value,
      role: els.assistantRole.value,
      style: els.assistantStyle.value,
      audience: els.assistantAudience.value
    }
  });
  state.data = result.state;
  render();
}

async function saveSettings() {
  const result = await api("/api/settings", {
    method: "POST",
    body: {
      chatModel: els.chatModel.value,
      embeddingModel: els.embeddingModel.value,
      temperature: Number(els.temperature.value),
      retrievalLimit: Number(els.retrievalLimit.value),
      strictDocuments: els.strictToggle.checked
    }
  });
  state.data = result.state;
  render();
}

async function uploadFiles(files) {
  if (!files.length) return;
  const assistant = activeAssistant();
  if (!assistant) return;

  els.uploadStatus.textContent = `Indexation de ${files.length} fichier${files.length > 1 ? "s" : ""}...`;
  const form = new FormData();
  form.append("assistantId", assistant.id);
  for (const file of files) form.append("files", file);

  try {
    const result = await api("/api/upload", {
      method: "POST",
      body: form
    });
    state.data = result.state;
    els.uploadStatus.textContent = "Document ajoute.";
    render();
  } catch (error) {
    els.uploadStatus.textContent = error.message;
  }
}

async function sendMessage(message) {
  if (!message.trim() || state.sending) return;
  state.sending = true;
  els.sendButton.disabled = true;
  els.sendButton.textContent = "Envoi...";

  try {
    await saveSettings();
    const result = await api("/api/chat", {
      method: "POST",
      body: {
        assistantId: state.activeAssistantId,
        message,
        strictDocuments: els.strictToggle.checked
      }
    });
    state.data = result.state;
    els.messageInput.value = "";
    render();
  } catch (error) {
    alert(error.message);
  } finally {
    state.sending = false;
    els.sendButton.disabled = false;
    els.sendButton.textContent = "Envoyer";
  }
}

async function runTerminalCommand(rawCommand) {
  const command = String(rawCommand || "").trim();
  if (!command || state.terminalRunning) return;

  if (command === "clear") {
    state.terminalEntries = [{ type: "system", text: "Terminal safe nettoye." }];
    renderTerminal();
    return;
  }

  state.terminalRunning = true;
  els.runTerminalButton.disabled = true;
  els.runTerminalButton.textContent = "Run...";
  els.terminalInput.value = "";
  state.terminalHistory.push(command);
  state.terminalHistory = state.terminalHistory.slice(-40);
  state.terminalHistoryIndex = -1;
  appendTerminal("input", command);

  try {
    const response = await fetch("/api/terminal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forge-Terminal": "1"
      },
      body: JSON.stringify({ command })
    });
    const result = await response.json().catch(() => ({}));

    if (result.stdout === "__CLEAR__") {
      state.terminalEntries = [{ type: "system", text: "Terminal safe nettoye." }];
      renderTerminal();
      return;
    }

    if (result.stdout) appendTerminal(result.ok ? "output" : "error", result.stdout);
    if (result.stderr) appendTerminal("error", result.stderr);
    if (!result.stdout && !result.stderr) {
      appendTerminal(result.ok ? "output" : "error", result.ok ? "Commande terminee sans sortie." : result.error || "Commande refusee.");
    }

    if (command.startsWith("ollama ")) {
      loadHealth().catch(() => {});
    }
  } catch (error) {
    appendTerminal("error", error.message);
  } finally {
    state.terminalRunning = false;
    els.runTerminalButton.disabled = false;
    els.runTerminalButton.textContent = "Run";
  }
}

els.assistantList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-assistant-id]");
  if (!button) return;
  state.activeAssistantId = button.dataset.assistantId;
  render();
});

els.createAssistantButton.addEventListener("click", async () => {
  const result = await api("/api/assistants", {
    method: "POST",
    body: {
      name: "Nouvelle IA",
      role: "Assistant personnel local qui utilise les documents fournis.",
      style: "Clair, concret, utile.",
      audience: "Utilisateur debutant en IA."
    }
  });
  state.data = result.state;
  state.activeAssistantId = result.assistant.id;
  render();
});

els.saveAssistantButton.addEventListener("click", () => {
  saveAssistant().catch((error) => alert(error.message));
});

els.saveSettingsButton.addEventListener("click", () => {
  saveSettings().catch((error) => alert(error.message));
});

els.strictToggle.addEventListener("change", () => {
  saveSettings().catch((error) => alert(error.message));
});

document.querySelectorAll("[data-persona]").forEach((button) => {
  button.addEventListener("click", () => applyPersona(button.dataset.persona));
});

els.pickFilesButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => uploadFiles([...els.fileInput.files]));

for (const eventName of ["dragenter", "dragover"]) {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("dragging");
  });
}

els.dropzone.addEventListener("drop", (event) => {
  uploadFiles([...event.dataTransfer.files]);
});

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(els.messageInput.value);
});

els.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
});

els.memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const assistant = activeAssistant();
  if (!assistant || !els.memoryInput.value.trim()) return;
  const result = await api(`/api/assistants/${assistant.id}/memories`, {
    method: "POST",
    body: { text: els.memoryInput.value }
  });
  state.data = result.state;
  els.memoryInput.value = "";
  render();
});

els.documentList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-doc]");
  if (!button) return;
  const result = await api(`/api/documents/${button.dataset.deleteDoc}`, { method: "DELETE" });
  state.data = result.state;
  render();
});

els.memoryList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-memory]");
  if (!button) return;
  const assistant = activeAssistant();
  const result = await api(`/api/assistants/${assistant.id}/memories/${button.dataset.deleteMemory}`, {
    method: "DELETE"
  });
  state.data = result.state;
  render();
});

els.terminalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runTerminalCommand(els.terminalInput.value);
});

els.clearTerminalButton.addEventListener("click", () => {
  state.terminalEntries = [{ type: "system", text: "Terminal safe nettoye." }];
  renderTerminal();
});

document.querySelectorAll(".terminal-quick").forEach((button) => {
  button.addEventListener("click", () => runTerminalCommand(button.dataset.command));
});

els.terminalInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!state.terminalHistory.length) return;
    state.terminalHistoryIndex = state.terminalHistoryIndex < 0
      ? state.terminalHistory.length - 1
      : Math.max(0, state.terminalHistoryIndex - 1);
    els.terminalInput.value = state.terminalHistory[state.terminalHistoryIndex];
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!state.terminalHistory.length || state.terminalHistoryIndex < 0) return;
    state.terminalHistoryIndex += 1;
    if (state.terminalHistoryIndex >= state.terminalHistory.length) {
      state.terminalHistoryIndex = -1;
      els.terminalInput.value = "";
    } else {
      els.terminalInput.value = state.terminalHistory[state.terminalHistoryIndex];
    }
  }
});

Promise.all([loadState(), loadHealth()]).catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});

setInterval(() => {
  loadHealth().catch(() => {});
}, 12000);
