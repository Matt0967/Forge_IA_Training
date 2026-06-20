# Forge IA Locale

Prototype local gratuit pour creer une IA personnalisee avec documents, memoire et Ollama.

## Lancer le dashboard

```bash
npm run dev
```

Ouvre ensuite:

```text
http://127.0.0.1:5173
```

## Installer Ollama

L'app fonctionne deja pour stocker les documents et faire une recherche de passages. Pour activer les vraies reponses LLM locales, installe Ollama puis lance:

```bash
ollama serve
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

Avec 16 Go de RAM, commence par `llama3.2:3b`. Tu peux essayer `qwen2.5:7b` si ton Mac reste fluide.

## Fonctions incluses

- Dashboard local sur ton Mac.
- Creation de plusieurs IA personnalisees.
- Drag and drop de documents.
- Extraction TXT, MD, CSV, JSON, DOCX/RTF via `textutil`, PDF en mode best effort.
- Indexation RAG avec embeddings Ollama si disponibles.
- Fallback recherche mots-cles si Ollama ou le modele d'embedding n'est pas pret.
- Chat local via Ollama.
- Memoire simple par assistant.
- Reglages modele, temperature, nombre de sources et mode "documents seulement".
- Terminal safe integre avec commandes Ollama autorisees et commandes dangereuses bloquees.

## Donnees locales

Les donnees restent dans:

```text
data/store.json
data/uploads/
```

Ces fichiers sont ignores par git pour eviter de versionner tes documents personnels.

## Limites du prototype

- Ce n'est pas un entrainement de LLM depuis zero.
- Le PDF sans `pdftotext` reste approximatif.
- Pas encore de comptes utilisateurs, paiement, quotas ou stockage cloud.
- Le terminal n'est pas un shell complet: il accepte seulement une liste de commandes safe.
- La prochaine etape SaaS serait Supabase + stockage objet + OpenRouter ou LiteLLM.
