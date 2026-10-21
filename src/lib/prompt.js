/**
 * Solver prompt builder + TuskCentral model catalog.
 * Classic script (no ESM). Wrapped in an IIFE so its internals never leak into
 * (or collide with) the shared global scope — safe to load more than once.
 * Exposes `globalThis.OQSPrompt`.
 * @module lib/prompt
 */

(() => {
  /**
   * Free-AI PROVIDERS.
   *
   * Each provider is a different free backend the extension can talk to. Model
   * ids are NOT interchangeable between providers (Tusk uses opaque backend
   * UUIDs, Pollinations uses "publisher/model" names, a local server uses
   * whatever you installed), so EVERY catalog below is keyed by provider id.
   *
   * A provider with an EMPTY model catalog (local servers, custom endpoints,
   * on-device AI) takes any model id: the user types it or picks it from the
   * list the endpoint reports.
   */
  const PROVIDERS = [
    { id: "tusk", name: "TuskCentral (no key needed)", needsKey: false },
    { id: "pollinations", name: "Pollinations (free key, far stronger)", needsKey: true },
    // The public Gemini WEB app (gemini.google.com), not the paid API: a
    // free, keyless, account-free frontier model. The protocol was ported
    // from https://github.com/HanaokaYuzu/Gemini-API (AGPL-3.0).
    { id: "geminiweb", name: "Google Gemini web app (no key, no account)", needsKey: false },
    // "private" providers run on the user's own machine: the extension never
    // falls back to a hosted one for them, so the question never leaves the
    // machine the user chose.
    { id: "ollama", name: "Ollama — local (no key, no account)", needsKey: false, private: true, baseUrl: "http://localhost:11434/v1" },
    { id: "lmstudio", name: "LM Studio — local (no key, no account)", needsKey: false, private: true, baseUrl: "http://localhost:1234/v1" },
    { id: "ondevice", name: "On-device AI — Chrome (no key, no account)", needsKey: false, private: true },
    { id: "custom", name: "Custom endpoint (your own free key)", needsKey: true, private: true, needsBaseUrl: true },
  ];

  /**
   * Ready-made base URLs for the "custom" provider. Every one of these has a
   * free tier that a USER can sign up for — the extension never ships or spends
   * anybody's key.
   */
  const BASE_URL_PRESETS = [
    { id: "groq", name: "Groq (free key)", baseUrl: "https://api.groq.com/openai/v1" },
    { id: "openrouter", name: "OpenRouter (free models)", baseUrl: "https://openrouter.ai/api/v1" },
    { id: "gemini", name: "Google Gemini (free tier)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { id: "cerebras", name: "Cerebras (free key)", baseUrl: "https://api.cerebras.ai/v1" },
    { id: "mistral", name: "Mistral (free tier)", baseUrl: "https://api.mistral.ai/v1" },
    { id: "nvidia", name: "NVIDIA NIM (free key)", baseUrl: "https://integrate.api.nvidia.com/v1" },
    { id: "ollama-cloud", name: "Ollama Cloud (free key)", baseUrl: "https://ollama.com/v1" },
    { id: "ollama-local", name: "Ollama (local)", baseUrl: "http://localhost:11434/v1" },
    { id: "lmstudio-local", name: "LM Studio (local)", baseUrl: "http://localhost:1234/v1" },
    { id: "custom", name: "Custom…", baseUrl: "" },
  ];

  /**
   * The provider used when nothing is configured. "geminiweb" is the public
   * Gemini web app: keyless, account-free, ~5 s per question, and measured
   * 6/6 correct — the best zero-setup default. "tusk" stays in the chain as a
   * fallback.
   */
  const DEFAULT_PROVIDER_ID = "geminiweb";

  /**
   * Model catalog per provider.
   * - tusk: opaque backend UUIDs from the Antigravity model list (name strings
   *   are rejected by that backend with HTTP 400).
   * - pollinations: "publisher/model" ids on gen.pollinations.ai. Every id
   *   listed here exists in the live catalog and is callable on the FREE tier
   *   (paid_only = false), so a free key is enough.
   * - ollama / lmstudio / custom / ondevice: empty on purpose — the model list
   *   comes from the endpoint itself (see OQSOpenAI.listModels).
   */
  const MODELS = {
    tusk: [
      { id: "2c2ae09e-7bea-4b12-a461-c34a9e084b93", name: "GPT-5.4 Nano", provider: "OpenAI" },
      { id: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", name: "GPT-5.4 Mini", provider: "OpenAI" },
      { id: "1c219738-5b7d-4bff-8edb-3f4d53fa4903", name: "GPT-5 Nano", provider: "OpenAI" },
      { id: "c1d7c9b6-b478-4398-a3c2-3d8914c986e9", name: "GPT-4o-mini", provider: "OpenAI" },
      { id: "d6ff02cf-f056-4b11-a802-e8791dadccfd", name: "Gemini 3.5 Flash Lite", provider: "Google" },
      { id: "21f6d265-8f41-40cb-a919-ad1879a26e6e", name: "Gemini 3.1 Flash Lite", provider: "Google" },
      { id: "a1a67a18-d926-42fe-8add-69514527643f", name: "DeepSeek V3.2", provider: "DeepSeek" },
      { id: "5c66d4f6-5818-49ec-a6bb-1331432559c9", name: "Llama 4 Maverick", provider: "Meta" },
    ],
    pollinations: [
      { id: "openai/gpt-5.4", name: "GPT-5.4", provider: "OpenAI" },
      { id: "openai/gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "OpenAI" },
      { id: "openai/gpt-5.4-nano", name: "GPT-5.4 Nano", provider: "OpenAI" },
      { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "OpenAI" },
      { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "Google" },
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "DeepSeek" },
      { id: "moonshotai/kimi-k3", name: "Kimi K3", provider: "Moonshot" },
      { id: "z-ai/glm-5.3", name: "GLM-5.3", provider: "Z.ai" },
      { id: "x-ai/grok-4.6", name: "Grok 4.6", provider: "xAI" },
      { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "Meta" },
    ],
    // Gemini WEB app model ids are the hex ids the web UI itself uses. They
    // are DISCOVERED per account at runtime (see OQSGeminiWeb.listModels);
    // these are the free-tier ones verified live on 2026-10-21.
    geminiweb: [
      { id: "fbb127bbb056c959", name: "Gemini Flash", provider: "Google", number: 1 },
      { id: "cf41b0e0dd7d53e5", name: "Gemini 3.5 Flash-Lite", provider: "Google", number: 6 },
      { id: "9d8ca3786ebdfbea", name: "Gemini Pro", provider: "Google", number: 3 },
    ],
    ollama: [],
    lmstudio: [],
    ondevice: [],
    custom: [],
  };

  /** Default (preferred) model per provider. Empty = the user picks one. */
  const DEFAULT_MODEL_ID = {
    tusk: "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", // GPT-5.4 Mini (accurate on SQL)
    pollinations: "openai/gpt-5.4",
    // Gemini Flash: the fastest strong model on the free web tier.
    geminiweb: "fbb127bbb056c959",
    ollama: "",
    lmstudio: "",
    ondevice: "",
    custom: "",
  };

  /**
   * Consensus panel per provider: three independent, distinct models voted for
   * the answer. Errors decorrelate across different providers, so a 3-way
   * majority is far more robust than any single model. The Pollinations panel
   * deliberately spans three different vendors (OpenAI / Google / DeepSeek).
   * Providers with an empty panel are answered in a single pass.
   */
  const CONSENSUS_MODELS = {
    tusk: [
      "bce9d196-5aa7-436a-9e28-760c6d3f8f3a", // GPT-5.4 Mini
      "d6ff02cf-f056-4b11-a802-e8791dadccfd", // Gemini 3.5 Flash Lite
      "1c219738-5b7d-4bff-8edb-3f4d53fa4903", // GPT-5 Nano
    ],
    pollinations: [
      "openai/gpt-5.4", // OpenAI
      "google/gemini-3.8-flash", // Google
      "deepseek/deepseek-v4-flash", // DeepSeek
    ],
    // The Gemini web app exposes one account's models, so a 3-model panel
    // would vote the SAME model three times — a wasted round trip that adds
    // no independence. The Gemini provider therefore answers in a single
    // pass (see canVote()).
    geminiweb: [],
    ollama: [],
    lmstudio: [],
    ondevice: [],
    custom: [],
  };

  /** @param {string} id */
  function providerById(id) {
    return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID);
  }

  /** Model list for a provider (falls back to the default provider's list). */
  function modelsFor(providerId) {
    return MODELS[providerId] ?? MODELS[DEFAULT_PROVIDER_ID];
  }

  /** The 3-model consensus panel for a provider. */
  function consensusFor(providerId) {
    return CONSENSUS_MODELS[providerId] ?? [];
  }

  /** Default model id for a provider. */
  function defaultModelFor(providerId) {
    return DEFAULT_MODEL_ID[providerId] ?? DEFAULT_MODEL_ID[DEFAULT_PROVIDER_ID];
  }

  /**
   * Resolve a preferred model id against a provider's catalog. A model id from
   * another provider (or a stale setting) falls back to that provider's
   * default instead of sending an unknown id to the backend. Providers with an
   * EMPTY catalog (local servers, custom endpoints, on-device) accept any id.
   * @param {string} providerId
   * @param {string} modelId
   */
  function resolveModel(providerId, modelId) {
    const list = modelsFor(providerId);
    if (!list.length) return String(modelId ?? "").trim();
    return list.some((m) => m.id === modelId) ? modelId : defaultModelFor(providerId);
  }

  /** Human-readable name of a model id (searches every provider catalog). */
  function modelName(id) {
    for (const list of Object.values(MODELS)) {
      const hit = list.find((m) => m.id === id);
      if (hit) return hit.name;
    }
    return "AI model";
  }

  // ---- Adaptive question-type detection -----------------------------------
  //
  // Oracle Academy assessments are NOT only SQL code. The same engine serves
  // Database Design / theory questions, data-modelling concepts, and ordinary
  // multiple-choice items, often written in Indonesian, French, German, etc.
  // We detect the KIND of question locally (pure, deterministic, no AI call) and
  // attach the matching expert module to a universal solving spine. This keeps
  // the SQL behaviour byte-for-byte (the SQL module IS the original prompt text)
  // while making the solver correct on everything else.

  /** SQL-query signals: an actual SELECT statement or DDL/column typing. */
  const SQL_CODE_RE = /\bselect\b[\s\S]{0,400}?\bfrom\b|\bcreate\s+(?:table|view|index)\b|\bvarchar2?\s*\(|\bnumber\s*\(\s*\d|\bnot\s+null\b|\bprimary\s+key\b[\s\S]{0,60}\bforeign\s+key\b/i;

  /** Non-SQL code signals (other languages / mixed syntax) when no SQL query. */
  const CODE_RE = /```|~~~|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\bclass\s+\w+[\s{:]|\bpublic\s+(?:static\s+)?\w+|\bprint\s*\(|\bconsole\.log\b|;\s*$/m;

  /**
   * Database-theory / concept vocabulary (English + the common Indonesian
   * Academy terms, since OA runs localized). A concept question usually has
   * natural-language choices, so this only matters when there is NO SQL code.
   */
  const DB_THEORY_RE = new RegExp(
    [
      // Stems: allow any suffix ("normalization", "entities", "cardinalities"...).
      "\\b(?:normaliz|denormaliz|optionalit|cardinalit|entity|entitie|attribute|relationship|relational|row\\b|column\\b|tuple|degree|arity|surrogate|referential|functional dependenc|dependenc|uniqueness|nullable|aggregation|composite key|candidate key|alternative key|primary key|foreign key|data ?model|object[- ]oriented)\\w*",
      "\\bschema\\w*",
      // Explicit multi-word / symbol phrases.
      "\\ber\\s*diagram\\b|\\berd\\b|crow'?s foot|\\bone[- ]to[- ](?:one|many)\\b|\\bmany[- ]to[- ]many\\b",
      // Indonesian equivalents (opsionalitas, hubungan, relasi, kunci, entitas...).
      "\\b(?:opsionalit|kardinalit|hubungan|relasi|entitas|atribut|kunci|normalisasi|ketergantungan|integritas|diagram|basis data|kunci primer|kunci asing|tabel|kolom|baris)\\w*",
    ].join("|"),
    "i"
  );

  /**
   * Classify a scraped question so the right expert module is used.
   * Pure and deterministic; safe with partial/missing fields.
   * @param {{ questionText?: string, choices?: Array<{ text?: string }> }} question
   * @returns {"sql-query"|"database-theory"|"code"|"general"}
   */
  function detectQuestionType(question) {
    const questionText = String(question?.questionText ?? "");
    const choiceText = (question?.choices ?? []).map((c) => String(c?.text ?? "")).join("\n");
    const text = `${questionText}\n${choiceText}`;

    // A real SQL query/DDL dominates: this is the case the SQL module is tuned for.
    if (SQL_CODE_RE.test(text)) return "sql-query";

    // Non-SQL code (another language / generic code) that is not SQL.
    if (CODE_RE.test(text)) return "code";

    // Database / data-modelling theory (the OA "Database Design" course).
    if (DB_THEORY_RE.test(text)) return "database-theory";

    return "general";
  }

  /**
   * Universal solving spine shared by every question type. The per-type expert
   * module (see EXPERT_MODULES) is appended after it. Keeps the model honest
   * across subjects and languages.
   */
  const GENERAL_SPINE = `You are an expert multiple-choice exam solver. You must pick the SINGLE best answer and you get it right.

LANGUAGE: The question may be written in any language (English, Indonesian/Bahasa, French, German, Japanese, Korean, Portuguese, Russian, Spanish, Chinese, ...). Understand it in its own language, reason in that language, but ALWAYS output the JSON keys in English exactly as specified below. Never let the language stop you from answering.

SUBJECT: Do NOT assume the subject is SQL. Identify the real subject from the question (SQL code, database design/theory, another programming language, general knowledge, math/logic, ...) and judge each choice by the rules of THAT subject.

METHOD (reason silently, do not print your reasoning):
A. Restate what the question is really asking (the goal) and note any given facts, schema, or definitions.
B. For EACH choice, mark it VALID or INVALID with a one-line cause, judged against the question's own domain.
C. Reject every INVALID choice. If exactly one remains VALID, pick it.
D. If several look valid, pick the one that is MOST correct and COMPLETE. Prefer the choice that fully and exactly satisfies the question, with no lucky/implicit assumptions.
E. Do NOT be fooled by a choice that "looks close" but is subtly wrong: wrong scope, wrong cause, an unstated assumption, a reversed relationship, a partial truth, or an absolute word ("always", "never", "only") that the evidence does not support.

IMPLEMENTATION-INTENT RESOLUTION (do this FIRST):
- Restate, silently, exactly WHAT the question wants. The #1 cause of wrong answers is a choice that is "almost right" but answers a slightly different question.
- Then eliminate any choice that does not answer EXACTLY the requested thing, even if it sounds plausible or technically true.

CONFIDENCE: report a calibrated 0..1. Use >=0.9 only when one choice is unambiguously correct and all others are clearly invalid.

OUTPUT: ONLY a JSON object, no markdown fences, no prose:
{"answerIndex": <0-based integer>, "confidence": <0..1>, "reason": "<one or two sentences naming the deciding factor>"}`;

  /**
   * Per-type expert modules appended after GENERAL_SPINE.
   * The "sql-query" module is the ORIGINAL SQL checklist, preserved verbatim so
   * SQL behaviour is unchanged. Each module only adds domain-specific rules and
   * then repeats the JSON output line.
   */
  const EXPERT_MODULES = {
    "sql-query": `
EXPERT LENS - ORACLE SQL: You are also an expert Oracle SQL examiner. Apply this checklist to every choice and mark it VALID or INVALID with a one-line cause:
   - Referenced tables/columns exist (respect the schema in the question; watch for misspelled names, wrong types).
   - Every table alias used is the SAME alias it was declared with (a table aliased "e" must be referenced as "e", never as its full name; unaliased tables must not be referenced by an alias that doesn't exist).
   - Joins are correct: an explicit join condition exists; JOIN ... ON / USING has a real common column; NATURAL JOIN only if the tables genuinely share join columns; cross joins are only correct when the question wants them.
   - Arithmetic/logic matches the goal (multiply when asked for a product, divide for a ratio, use NVL for NULL-safety where the question implies it).
   - GROUP BY / HAVING / ORDER BY / DISTINCT / aggregation are used correctly if the goal needs them.
   - No syntax errors (clause order, commas, quotes, operator misuse).

FEW-SHOT EXAMPLES OF TRAPS TO REJECT:
- "SELECT e.first_name ... FROM employees e, bonus b WHERE e.employee_id = b.employee_id" while another choice uses "b.bonus_pct" but the table is referenced as "bonus_pct" without the alias -> invalid alias.
- A choice that returns the raw bonus_pct instead of annual_salary * bonus_pct when the question asks for the bonus AMOUNT -> wrong arithmetic.
- "FROM employees, bonus NATURAL JOIN" (invalid syntax / no join column) -> invalid.
- A choice that omits the join condition entirely -> cartesian product, invalid.`,

    "database-theory": `
EXPERT LENS - DATABASE DESIGN / THEORY: This is a data-modelling / database-concept question (e.g. Oracle Academy "Database Design"). Judge each statement by precise textbook meaning, not vague resemblance.
   - Definition precision: the correct statement must match the formal definition exactly (entity vs attribute vs relationship; optionality vs cardinality; unique vs primary vs foreign key; normal forms 1NF/2NF/3NF; functional dependency).
   - Scope: reject a statement that is true only in a special case but is stated as a general rule, or that conflates two distinct concepts.
   - Absolute words ("always", "never", "only", "all", "must") are usually WRONG in these questions - the correct answer is typically the careful, accurate statement.
   - Watch for the classic trap: a choice that is a common misconception, or that swaps cause and effect / the two sides of a relationship.

FEW-SHOT EXAMPLES OF TRAPS TO REJECT:
- "Optionality determines only singularity or plurality, but not a specific number." vs "Optionality determines whether something is required or not." -> optionality is about required/optional, so the first is a misconception (invalid).
- A choice that says a foreign key must be unique -> invalid (uniqueness is the primary key's job, not a general rule for foreign keys).`,

    code: `
EXPERT LENS - CODE (non-SQL): This is a programming question. Evaluate each choice against the language's real semantics.
   - Syntax validity: the code must compile/parse (correct keywords, brackets, operators, quoting).
   - Semantics: the code must compute/return EXACTLY what the question asks (not merely run without error).
   - Common traps: off-by-one, wrong variable scope, wrong operator precedence, mutation vs copy, incorrect return value.`,

    general: `
EXPERT LENS - GENERAL: There is no special domain here. Judge each choice by the question's own facts and standard reasoning:
   - The correct choice follows logically from the given information and general knowledge.
   - Reject choices with unstated assumptions, reversed logic, or absolute words the evidence does not support.`,
  };

  /** Compose the full single-select system prompt for a question. */
  function buildSystemPrompt(question) {
    const type = detectQuestionType(question);
    return `${GENERAL_SPINE}\n\n${EXPERT_MODULES[type] ?? EXPERT_MODULES.general}`;
  }

  /** Render the numbered choice list shared by every prompt. */
  function renderChoices(question) {
    return (question?.choices ?? []).map((c, i) => `[${i}] ${c.text}`).join("\n");
  }

  /** Accept only a non-negative integer index, including numeric JSON strings. */
  function parseAnswerIndex(value) {
    const valid =
      (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "string" && /^\d+$/.test(value.trim()));
    if (!valid) return null;
    const index = Number(value);
    return Number.isSafeInteger(index) ? index : null;
  }

  /** Confidence is defined as a probability; malformed values must not raise trust. */
  function parseConfidence(value) {
    if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return 0;
    const confidence = Number(value);
    return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0;
  }

  /**
   * Build the user content string handed to the model.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @returns {string}
   */
  function buildSolverPrompt(question) {
    return `${buildSystemPrompt(question)}

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${renderChoices(question)}

Apply the METHOD, then respond with the JSON object only.`;
  }

  /**
   * Plural solving spine: the question expects MORE THAN ONE correct answer
   * ("Select all that apply" / "Pilih dua"). Generalized across subjects and
   * languages; the per-type multi module is appended by buildMultiSolverPrompt().
   */
  const MULTI_SPINE = `You are an expert multiple-choice exam solver. This question has MORE THAN ONE correct answer and you must find ALL of them and none of the wrong ones.

LANGUAGE: The question may be written in any language (English, Indonesian/Bahasa, French, German, Japanese, Korean, Portuguese, Russian, Spanish, Chinese, ...). Understand and reason in its own language, but ALWAYS output the JSON keys in English exactly as specified below.

SUBJECT: Do NOT assume the subject is SQL. Identify the real subject from the question and judge each choice by the rules of THAT subject.

METHOD (reason silently, do not print your reasoning):
A. Restate what the question is really asking (the goal) and note any given facts, schema, or definitions.
B. For EACH choice, mark it VALID or INVALID with a one-line cause, judged against the question's own domain.
C. Collect EVERY choice that is VALID. Do NOT stop at the first one. Do NOT pad the set with a wrong choice to reach a count.
D. If the question states a count (e.g. "choose two"), prefer that many answers, but NEVER include an INVALID choice just to hit the count. If only one choice is truly valid, return just that one.
E. Do NOT be fooled by a choice that "looks close" but is subtly wrong (wrong scope, reversed relationship, partial truth, or an unsupported absolute word).

IMPLEMENTATION-INTENT RESOLUTION (do this FIRST):
- Restate, silently, exactly WHAT the question wants. Eliminate any choice that does not answer EXACTLY the requested thing, even if it sounds plausible.

CONFIDENCE: report a calibrated 0..1 for the WHOLE set. Use >=0.9 only when the selected set is unambiguously exactly right.

OUTPUT: ONLY a JSON object, no markdown fences, no prose:
{"answerIndexes": [<0-based integers, ascending, no duplicates>], "confidence": <0..1>, "reason": "<one or two sentences naming the deciding factor>"}`;

  /**
   * Per-type multi modules. The "sql-query" module preserves the original SQL
   * checklist and traps verbatim so SQL multi-select behaviour is unchanged.
   */
  const EXPERT_MODULES_MULTI = {
    "sql-query": `
EXPERT LENS - ORACLE SQL: You are also an expert Oracle SQL examiner. Apply this checklist to every choice and mark it VALID or INVALID with a one-line cause:
   - Referenced tables/columns exist (respect the schema in the question; watch for misspelled names, wrong types).
   - Every table alias used is the SAME alias it was declared with (a table aliased "e" must be referenced as "e", never as its full name; unaliased tables must not be referenced by an alias that doesn't exist).
   - Joins are correct: an explicit join condition exists; JOIN ... ON / USING has a real common column; NATURAL JOIN only if the tables genuinely share join columns; cross joins are only correct when the question wants them.
   - Arithmetic/logic matches the goal (multiply when asked for a product, divide for a ratio, use NVL for NULL-safety where the question implies it).
   - GROUP BY / HAVING / ORDER BY / DISTINCT / aggregation are used correctly if the goal needs them.
   - No syntax errors (clause order, commas, quotes, operator misuse).

FEW-SHOT EXAMPLES OF TRAPS TO REJECT:
- "SELECT e.first_name ... FROM employees e, bonus b WHERE e.employee_id = b.employee_id" while another choice uses "b.bonus_pct" but the table is referenced as "bonus_pct" without the alias -> invalid alias.
- A choice that returns the raw bonus_pct instead of annual_salary * bonus_pct when the question asks for the bonus AMOUNT -> wrong arithmetic.
- "FROM employees, bonus NATURAL JOIN" (invalid syntax / no join column) -> invalid.
- A choice that omits the join condition entirely -> cartesian product, invalid.`,

    "database-theory": `
EXPERT LENS - DATABASE DESIGN / THEORY: Judge each statement by precise textbook meaning, not vague resemblance.
   - Definition precision: entity vs attribute vs relationship; optionality vs cardinality; unique vs primary vs foreign key; normal forms; functional dependency.
   - Reject a statement that is true only in a special case but stated as a general rule, or that conflates two distinct concepts.
   - Absolute words ("always", "never", "only", "all", "must") are usually WRONG; the correct answers are the careful, accurate statements.
   - Watch for common misconceptions and swapped cause/effect or relationship sides.`,

    code: `
EXPERT LENS - CODE (non-SQL): Evaluate each choice against the language's real semantics: syntax validity, and whether it computes/returns EXACTLY what is asked. Common traps: off-by-one, wrong scope, wrong precedence, mutation vs copy.`,

    general: `
EXPERT LENS - GENERAL: No special domain. Keep every choice that follows logically from the question's own facts and standard reasoning; reject unstated assumptions, reversed logic, and unsupported absolute words.`,
  };

  /** Compose the full multi-select system prompt for a question. */
  function buildMultiSystemPrompt(question) {
    const type = detectQuestionType(question);
    return `${MULTI_SPINE}\n\n${EXPERT_MODULES_MULTI[type] ?? EXPERT_MODULES_MULTI.general}`;
  }

  /**
   * Build the user content string for a multi-select question.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {number|null} [requiredCount]  how many answers the question asks for, if stated
   * @returns {string}
   */
  function buildMultiSolverPrompt(question, requiredCount) {
    const n = (question?.choices ?? []).length;
    const countLine =
      requiredCount && requiredCount > 0
        ? `\nThis question asks for exactly ${requiredCount} answer${requiredCount === 1 ? "" : "s"} (select all that apply). Return ${requiredCount} index${requiredCount === 1 ? "" : "es"} if that many choices are truly correct.`
        : `\nThis question asks for ALL correct answers (select all that apply). Return EVERY correct index, which is usually 2 or more but could be just 1.`;
    return `${buildMultiSystemPrompt(question)}${countLine}

QUESTION:
${question?.questionText ?? ""}

CHOICES (0 to ${Math.max(0, n - 1)}):
${renderChoices(question)}

Return a JSON object with an "answerIndexes" ARRAY holding every correct index (for example {"answerIndexes":[0,2],"confidence":0.9,"reason":"..."}). Do NOT return a single number for a select-all question unless only one choice is correct. Respond with the JSON object only.`;
  }

  /**
   * Coerce a raw parsed value into a clean, sorted, unique array of indexes.
   * Accepts numbers, numeric strings, arrays of either, and a single string that
   * itself contains a list ("2, 3" or "[2, 3]") - models frequently emit any of
   * these for a multi-answer set.
   * @param {unknown} value
   * @returns {number[]}
   */
  function toIndexArray(value) {
    const out = [];
    const push = (v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && !out.includes(n)) out.push(n);
    };
    const walk = (v) => {
      if (v == null) return;
      if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (typeof v === "number") {
        push(v);
      } else if (typeof v === "string") {
        // A string may hold one index ("2"), a list ("2, 3"), or bracketed JSON.
        const nums = v.match(/\d+/g);
        if (nums) nums.forEach(push);
      }
    };
    walk(value);
    return out.sort((a, b) => a - b);
  }

  /**
   * Last-resort extractor for a reply whose JSON could not be parsed: scan the
   * text for an "answerIndexes"/"answerIndex" field and read the integers that
   * follow it, preferring a bracketed list. Never throws.
   * @param {string} text
   * @returns {number[]}
   */
  function scrapeIndexesFromText(text) {
    // Prefer the value attached to answerIndexes/answerIndex.
    const keyed = text.match(/answer\s*index(?:es)?\s*["']?\s*[:=]\s*(\[[^\]]*\]|\d+(?:\s*,\s*\d+)*)/i);
    if (keyed) {
      const nums = keyed[1].match(/\d+/g);
      if (nums) return [...new Set(nums.map(Number))].sort((a, b) => a - b);
    }
    // Otherwise take the first bracketed integer list in the reply.
    const bracketed = text.match(/\[([^\]]*\d[^\]]*)\]/);
    if (bracketed) {
      const nums = bracketed[1].match(/\d+/g);
      if (nums) return [...new Set(nums.map(Number))].sort((a, b) => a - b);
    }
    return [];
  }

  /**
   * Parse a multi-select model reply into a strict result.
   * Accepts {"answerIndexes":[...]} and tolerates:
   *   - a lone {"answerIndex":N} (wrapped into a single-element array),
   *   - answerIndexes as a string ("[0,2]" or "0, 2"),
   *   - a fenced / prose-wrapped JSON object,
   *   - a reply with no valid JSON at all (regex fallback on the raw text).
   * @param {string} raw
   * @returns {{ answerIndexes: number[], confidence: number, reason: string } | null}
   */
  function parseMultiSolverReply(raw) {
    if (!raw || typeof raw !== "string") return null;
    let text = raw.trim();

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const slice = start !== -1 && end !== -1 && end > start ? text.slice(start, end + 1) : text;

    let obj = null;
    try {
      obj = JSON.parse(slice);
    } catch {
      obj = null;
    }

    if (obj && typeof obj === "object") {
      const indexes = toIndexArray(obj.answerIndexes ?? obj.answerIndex ?? obj.answerIdx ?? obj.indexes);
      if (indexes.length > 0) {
        return {
          answerIndexes: indexes,
          confidence: parseConfidence(obj.confidence),
          reason: String(obj.reason ?? "").slice(0, 500),
        };
      }
    }

    // JSON parse failed or carried no indexes: fall back to scraping the text.
    const scraped = scrapeIndexesFromText(text);
    if (scraped.length > 0) {
      const confMatch = text.match(/confidence\s*["']?\s*[:=]\s*([0-9.]+)/i);
      const reasonMatch = text.match(/reason\s*["']?\s*[:=]\s*["']([^"']{0,500})/i);
      return {
        answerIndexes: scraped,
        confidence: confMatch ? parseConfidence(confMatch[1]) : 0,
        reason: reasonMatch ? reasonMatch[1].slice(0, 500) : "",
      };
    }

    return null;
  }

  /**
   * A second-opinion prompt: given the question, choices, and a first proposed
   * answer, ask the model to independently verify it (catches the model's first
   * mistake). Returns JSON with an overriding answerIndex when it disagrees.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {number} proposedIndex
   * @returns {string}
   */
  function buildVerifierPrompt(question, proposedIndex) {
    const choices = (question?.choices ?? []).map((c, i) => `[${i}] ${c.text}`).join("\n");
    const isSql = detectQuestionType(question) === "sql-query";
    const persona = isSql
      ? "You are a meticulous Oracle SQL grader."
      : "You are a meticulous exam grader.";
    const check = isSql
      ? "Verify the proposed answer against the schema, the aliases, the join condition, and the arithmetic the question asks for. If it has ANY flaw, choose the best alternative. Be specific about aliases, join conditions, and arithmetic."
      : "Verify the proposed answer against the question's own facts and subject. Check scope, exact wording, and any reversed or absolute claims. If it has ANY flaw, choose the best alternative.";
    return `${persona} Another solver proposed an answer, but it may be wrong. Independently determine the correct choice. The question may be in any language; reason in its language but output the JSON keys in English.

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${choices}

PROPOSED ANSWER: [${proposedIndex}] ${question?.choices?.[proposedIndex]?.text ?? ""}

${check}

OUTPUT: ONLY a JSON object, no markdown fences:
{"agree": <true|false>, "answerIndex": <0-based integer you believe is correct>, "confidence": <0..1>, "reason": "<one sentence: the decisive correctness check>"}`;
  }

  /**
   * Parse a verifier reply.
   * @param {string} raw
   * @returns {{ agree: boolean, answerIndex: number, confidence: number, reason: string } | null}
   */
  function parseVerifierReply(raw) {
    if (!raw || typeof raw !== "string") return null;
    let text = raw.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
    try {
      const obj = JSON.parse(text);
      const idx = parseAnswerIndex(obj.answerIndex);
      if (idx === null) return null;
      return {
        agree: obj.agree === true || obj.agree === "true",
        answerIndex: idx,
        confidence: parseConfidence(obj.confidence),
        reason: String(obj.reason ?? "").slice(0, 500),
      };
    } catch {
      return null;
    }
  }

  /**
   * Multi-select verifier: given the question, choices, and a proposed SET of
   * answers, ask the model to independently confirm or correct the whole set.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {number[]} proposedIndexes
   * @returns {string}
   */
  function buildMultiVerifierPrompt(question, proposedIndexes) {
    const choices = renderChoices(question);
    const proposed = (proposedIndexes ?? [])
      .map((i) => `[${i}] ${question?.choices?.[i]?.text ?? ""}`)
      .join("\n");
    const isSql = detectQuestionType(question) === "sql-query";
    const persona = isSql
      ? "You are a meticulous Oracle SQL grader."
      : "You are a meticulous exam grader.";
    const check = isSql
      ? "Verify EVERY valid choice against the schema, the aliases, the join condition, and the arithmetic the question asks for."
      : "Verify EVERY valid choice against the question's own facts and subject, checking scope and exact wording.";
    return `${persona} This question has MORE THAN ONE correct answer. Another solver proposed a set, but it may be wrong (missing a correct choice or including a wrong one).

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${choices}

PROPOSED ANSWER SET:
${proposed}

Add any correct choice that is missing and remove any incorrect choice that was included. The question may be in any language; reason in its language but output the JSON keys in English.

OUTPUT: ONLY a JSON object, no markdown fences:
{"answerIndexes": [<0-based integers, the complete correct set, ascending>], "confidence": <0..1>, "reason": "<one sentence: the decisive correctness check>"}`;
  }

  /**
   * Parse a multi verifier reply.
   * @param {string} raw
   * @returns {{ answerIndexes: number[], confidence: number, reason: string } | null}
   */
  function parseMultiVerifierReply(raw) {
    const parsed = parseMultiSolverReply(raw);
    if (!parsed) return null;
    return {
      answerIndexes: parsed.answerIndexes,
      confidence: parsed.confidence,
      reason: parsed.reason,
    };
  }

  /**
   * Focused "fill" prompt: the models agreed on a set that is SHORTER than the
   * question requires, so ask which additional choice(s) also belong. Used only
   * when a stated count cannot be met from the panel votes.
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {number[]} chosenIndexes  the indexes already chosen
   * @param {number} need             how many extra answers are still required
   * @returns {string}
   */
  function buildMultiFillPrompt(question, chosenIndexes, need) {
    const chosen = [...new Set(chosenIndexes ?? [])].sort((a, b) => a - b);
    const chosenList = chosen.map((i) => `[${i}] ${question?.choices?.[i]?.text ?? ""}`).join("\n");
    const remaining = (question?.choices ?? [])
      .map((c, i) => ({ i, c }))
      .filter(({ i }) => !chosen.includes(i))
      .map(({ i, c }) => `[${i}] ${c.text}`)
      .join("\n");
    const persona =
      detectQuestionType(question) === "sql-query"
        ? "You are an expert Oracle SQL exam solver."
        : "You are an expert exam solver.";
    return `${persona} This question has MORE THAN ONE correct answer. A first pass already selected this part of the answer:

ALREADY SELECTED:
${chosenList}

QUESTION:
${question?.questionText ?? ""}

Which ${need} ADDITIONAL choice${need === 1 ? "" : "s"} from the list below ${need === 1 ? "is" : "are"} also correct? Pick from these only (the question may be in any language; output the JSON keys in English):
${remaining}

OUTPUT: ONLY a JSON object, no markdown fences:
{"answerIndexes": [<${need} 0-based integer${need === 1 ? "" : "s"} from the list above>], "confidence": <0..1>, "reason": "<one sentence>"}`;
  }

  /**
   * Parse the model reply into a strict solver result.
   * Tolerant of stray markdown fences or surrounding text.
   * @param {string} raw
   * @returns {{ answerIndex: number, confidence: number, reason: string } | null}
   */
  function parseSolverReply(raw) {
    if (!raw || typeof raw !== "string") return null;
    let text = raw.trim();

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }

    try {
      const obj = JSON.parse(text);
      const idx = parseAnswerIndex(obj.answerIndex);
      if (idx === null) return null;
      return {
        answerIndex: idx,
        confidence: parseConfidence(obj.confidence),
        reason: String(obj.reason ?? "").slice(0, 500),
      };
    } catch {
      return null;
    }
  }

  /**
   * Build a REPAIR prompt for a reply that could not be parsed into an
   * answer. The model is told exactly which shape was expected and is shown
   * its own previous reply, so it can correct itself instead of guessing
   * again from scratch.
   *
   * Retrying with the same prompt is useless: a model that answered with
   * prose will usually answer with prose again. Saying what went wrong is
   * what makes the second attempt work.
   *
   * @param {{ questionText: string, choices: Array<{ id?: string, text: string }> }} question
   * @param {string} previousReply  the reply that could not be parsed
   * @param {boolean} multi  true for a select-all question
   * @returns {string}
   */
  function buildRetryPrompt(question, previousReply, multi = false) {
    const choices = renderChoices(question);
    const count = (question?.choices ?? []).length;
    const previous = String(previousReply ?? "").slice(0, 600) || "(the reply was empty)";
    const shape = multi
      ? `{"answerIndexes": [<0-based integers, ascending, no duplicates>], "confidence": <0..1>, "reason": "<one sentence>"}`
      : `{"answerIndex": <0-based integer between 0 and ${Math.max(0, count - 1)}>, "confidence": <0..1>, "reason": "<one sentence>"}`;
    const indexLine = multi
      ? `The "answerIndexes" value MUST be an ARRAY of numbers, for example [0,2].`
      : `The "answerIndex" value MUST be a single number, not an array and not a string.`;

    return `Your previous reply could not be read as an answer, so no choice was selected.

YOUR PREVIOUS REPLY:
${previous}

Reply again, and this time follow the output format EXACTLY.

${indexLine}
The "confidence" value must be a number between 0 and 1.
The "reason" value must be a short string.
Output the JSON object and NOTHING else: no explanation, no markdown, no code fences.

QUESTION:
${question?.questionText ?? ""}

CHOICES:
${choices}

The answer must be ONE of these shapes, exactly:
${shape}`;
  }

  globalThis.OQSPrompt = {
    PROVIDERS,
    BASE_URL_PRESETS,
    DEFAULT_PROVIDER_ID,
    MODELS,
    DEFAULT_MODEL_ID,
    CONSENSUS_MODELS,
    providerById,
    modelsFor,
    consensusFor,
    defaultModelFor,
    resolveModel,
    modelName,
    detectQuestionType,
    buildSystemPrompt,
    buildMultiSystemPrompt,
    buildSolverPrompt,
    parseSolverReply,
    buildVerifierPrompt,
    parseVerifierReply,
    buildMultiSolverPrompt,
    parseMultiSolverReply,
    buildMultiVerifierPrompt,
    parseMultiVerifierReply,
    buildMultiFillPrompt,
    buildRetryPrompt,
  };
})();
